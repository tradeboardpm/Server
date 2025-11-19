const jwt = require("jsonwebtoken");
const AccountabilityPartner = require("../models/AccountabilityPartner");
const User = require("../models/User");
const Trade = require("../models/Trade");
const Rule = require("../models/Rule");
const RuleState = require("../models/RuleState");
const Journal = require("../models/Journal");
const emailService = require("../services/emailService");
const moment = require("moment");
const { normalizeDate, formatDate } = require("../utils/dateHelper");
const { getEffectiveRulesForDate } = require("../utils/ruleHelper");

// =======================================================================
// SEND ACCOUNTABILITY EMAIL + UPDATE lastSharedDate
// =======================================================================
const sendAccountabilityEmail = async (accountabilityPartner) => {
  try {
    const sharedData = await generateSharedData(accountabilityPartner._id);
    await emailService.sendAccountabilityUpdate(
      accountabilityPartner,
      sharedData
    );

    // Only update after successful send
    accountabilityPartner.lastSharedDate = new Date();
    await accountabilityPartner.save();

    console.log(`Accountability email sent to: ${accountabilityPartner.email}`);
  } catch (error) {
    console.error(
      `Failed to send email to ${accountabilityPartner.email}:`,
      error
    );
    throw error; // Let caller handle
  }
};

// =======================================================================
// ADD ACCOUNTABILITY PARTNER
// =======================================================================
exports.addAccountabilityPartner = async (req, res) => {
  try {
    const { name, email, relation, dataToShare, shareFrequency } = req.body;

    // Validation
    if (!name || !email || !dataToShare) {
      return res.status(400).json({
        success: false,
        error: "Name, email, and dataToShare are required",
      });
    }

    // Max 5 partners
    const count = await AccountabilityPartner.countDocuments({
      user: req.user._id,
    });
    if (count >= 5) {
      return res.status(400).json({
        success: false,
        error: "Maximum 5 accountability partners allowed",
      });
    }

    // No duplicate email
    const exists = await AccountabilityPartner.findOne({
      user: req.user._id,
      email: email.toLowerCase(),
    });
    if (exists) {
      return res.status(400).json({
        success: false,
        error: "Partner with this email already exists",
      });
    }

    // Create partner
    const partner = new AccountabilityPartner({
      user: req.user._id,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      relation: relation.trim(),
      dataToShare,
      shareFrequency: shareFrequency || "weekly",
    });
    await partner.save();

    // 1. Send welcome email
    try {
      await emailService.sendNewPartnerEmail(req.user, partner);
    } catch (err) {
      console.error("Welcome email failed:", err);
    }

    // 2. Send FIRST accountability email (current period)
    try {
      await sendAccountabilityEmail(partner);
    } catch (err) {
      console.error("First accountability email failed:", err);
    }

    res.status(201).json({
      success: true,
      data: partner,
    });
  } catch (error) {
    console.error("addAccountabilityPartner error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

// =======================================================================
// UPDATE ACCOUNTABILITY PARTNER
// =======================================================================
exports.updateAccountabilityPartner = async (req, res) => {
  try {
    const updates = Object.keys(req.body);
    const allowedUpdates = [
      "name",
      "email",
      "relation",
      "dataToShare",
      "shareFrequency",
    ];

    const isValid = updates.every((u) => allowedUpdates.includes(u));
    if (!isValid) {
      return res.status(400).json({
        success: false,
        error: "Invalid update fields",
      });
    }

    const partner = await AccountabilityPartner.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: "Accountability partner not found",
      });
    }

    // Update fields
    updates.forEach((key) => {
      if (key === "email") {
        partner[key] = req.body[key].toLowerCase().trim();
      } else {
        partner[key] = req.body[key];
      }
    });

    await partner.save();

    res.json({
      success: true,
      data: partner,
    });
  } catch (error) {
    console.error("updateAccountabilityPartner error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

// =======================================================================
// GET ALL PARTNERS
// =======================================================================
exports.getAccountabilityPartners = async (req, res) => {
  try {
    const partners = await AccountabilityPartner.find({
      user: req.user._id,
    }).select("-__v");

    res.json({
      success: true,
      data: partners,
    });
  } catch (error) {
    console.error("getAccountabilityPartners error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

// =======================================================================
// DELETE PARTNER
// =======================================================================
exports.deleteAccountabilityPartner = async (req, res) => {
  try {
    const partner = await AccountabilityPartner.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: "Partner not found",
      });
    }

    res.json({
      success: true,
      message: "Accountability partner deleted",
    });
  } catch (error) {
    console.error("deleteAccountabilityPartner error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

// =======================================================================
// CALCULATE METRICS FOR DATE RANGE
// =======================================================================
const calculateDateRangeMetrics = async (userId, startDate, endDate) => {
  const [trades, journals, rules, ruleStates] = await Promise.all([
    Trade.find({ user: userId, date: { $gte: startDate, $lte: endDate } }),
    Journal.find({ user: userId, date: { $gte: startDate, $lte: endDate } }),
    Rule.find({ user: userId }),
    RuleState.find({
      user: userId,
      date: { $gte: startDate, $lte: endDate },
      isActive: true,
    }).populate("rule"),
  ]);

  const daily = {};
  const overall = {
    tradesTaken: 0,
    rulesFollowed: 0,
    rulesUnfollowed: 0,
    totalProfitLoss: 0,
    winTrades: 0,
    lossTrades: 0,
    wordsJournaled: 0,
  };

  const profitDays = {
    count: 0,
    rulesFollowed: 0,
    tradesTaken: 0,
    winTrades: 0,
    wordsJournaled: 0,
  };
  const lossDays = {
    count: 0,
    rulesFollowed: 0,
    tradesTaken: 0,
    winTrades: 0,
    wordsJournaled: 0,
  };
  const breakEvenDays = {
    count: 0,
    rulesFollowed: 0,
    tradesTaken: 0,
    winTrades: 0,
    wordsJournaled: 0,
  };

  // Initialize daily metrics
  let cur = moment(startDate);
  while (cur <= moment(endDate)) {
    const d = cur.format("YYYY-MM-DD");
    daily[d] = {
      tradesTaken: 0,
      rulesFollowed: 0,
      rulesUnfollowed: 0,
      totalProfitLoss: 0,
      winTrades: 0,
      lossTrades: 0,
      winRate: 0,
      wordsJournaled: 0,
      hasSmallTrade: false,
    };
    cur.add(1, "day");
  }

  // Process trades
  trades.forEach((t) => {
    const d = moment(t.date).format("YYYY-MM-DD");
    if (!daily[d]) return;

    daily[d].tradesTaken++;
    overall.tradesTaken++;

    if (t.action === "both") {
      const pnl =
        (t.sellingPrice - t.buyingPrice) * t.quantity -
        (t.exchangeRate + t.brokerage);
      daily[d].totalProfitLoss += pnl;
      overall.totalProfitLoss += pnl;

      if (pnl > 0) {
        daily[d].winTrades++;
        overall.winTrades++;
      } else if (pnl < 0) {
        daily[d].lossTrades++;
        overall.lossTrades++;
      }
      if (Math.abs(pnl) < 100) daily[d].hasSmallTrade = true;
    }
  });

  // Journals
  journals.forEach((j) => {
    const d = moment(j.date).format("YYYY-MM-DD");
    if (!daily[d]) return;
    const words = (j.note + " " + j.mistake + " " + j.lesson).split(
      /\s+/
    ).length;
    daily[d].wordsJournaled += words;
    overall.wordsJournaled += words;
  });

  // Rule states
  ruleStates.forEach((rs) => {
    const d = moment(rs.date).format("YYYY-MM-DD");
    if (!daily[d]) return;
    rs.isFollowed ? daily[d].rulesFollowed++ : daily[d].rulesUnfollowed++;
    rs.isFollowed ? overall.rulesFollowed++ : overall.rulesUnfollowed++;
  });

  // Finalize daily + profit/loss days
  Object.keys(daily).forEach((d) => {
    const m = daily[d];
    m.winRate = m.tradesTaken > 0 ? (m.winTrades / m.tradesTaken) * 100 : 0;

    const isBreakEven =
      m.rulesFollowed > 0 || m.hasSmallTrade || m.wordsJournaled > 0;

    if (m.totalProfitLoss > 100 && !isBreakEven) {
      profitDays.count++;
      profitDays.rulesFollowed += m.rulesFollowed;
      profitDays.tradesTaken += m.tradesTaken;
      profitDays.winTrades += m.winTrades;
      profitDays.wordsJournaled += m.wordsJournaled;
    } else if (m.totalProfitLoss < -100 && !isBreakEven) {
      lossDays.count++;
      lossDays.rulesFollowed += m.rulesFollowed;
      lossDays.tradesTaken += m.tradesTaken;
      lossDays.winTrades += m.winTrades;
      lossDays.wordsJournaled += m.wordsJournaled;
    } else {
      breakEvenDays.count++;
      breakEvenDays.rulesFollowed += m.rulesFollowed;
      breakEvenDays.tradesTaken += m.tradesTaken;
      breakEvenDays.winTrades += m.winTrades;
      breakEvenDays.wordsJournaled += m.wordsJournaled;
    }
  });

  const avg = (data) => ({
    avgRulesFollowed:
      data.count > 0
        ? (data.rulesFollowed / (data.count * rules.length)) * 100
        : 0,
    avgTradesTaken: data.count > 0 ? data.tradesTaken / data.count : 0,
    winRate:
      data.tradesTaken > 0 ? (data.winTrades / data.tradesTaken) * 100 : 0,
    avgWordsJournaled: data.count > 0 ? data.wordsJournaled / data.count : 0,
  });

  // Top rules
  const followed = {};
  const unfollowed = {};
  ruleStates.forEach((rs) => {
    if (rs.rule) {
      const desc = rs.rule.description;
      rs.isFollowed
        ? (followed[desc] = (followed[desc] || 0) + 1)
        : (unfollowed[desc] = (unfollowed[desc] || 0) + 1);
    }
  });

  const topFollowed = Object.entries(followed)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([r, c]) => ({ rule: r, followedCount: c }));

  const topUnfollowed = Object.entries(unfollowed)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([r, c]) => ({ rule: r, unfollowedCount: c }));

  return {
    overall: {
      ...overall,
      winRate:
        overall.tradesTaken > 0
          ? (overall.winTrades / overall.tradesTaken) * 100
          : 0,
      profitLossSummary: {
        profit_days: avg(profitDays),
        loss_days: avg(lossDays),
        breakEven_days: avg(breakEvenDays),
      },
      topFollowedRules: topFollowed,
      topUnfollowedRules: topUnfollowed,
    },
    detailed: daily,
    sharedDates: Object.keys(daily),
  };
};

// =======================================================================
// generateSharedData – NOW 100% IDENTICAL TO getWeeklyData LOGIC
// =======================================================================
const generateSharedData = async (partnerId) => {
  const partner = await AccountabilityPartner.findById(partnerId);
  if (!partner) throw new Error("Partner not found");

  const user = await User.findById(partner.user);
  if (!user) throw new Error("User not found");

  const { dataToShare, shareFrequency } = partner;
  const now = moment().utc();
  const isWeekly = shareFrequency === "weekly";

  const start = isWeekly
    ? now.clone().startOf("week")
    : now.clone().startOf("month");
  const end = isWeekly ? now.clone().endOf("week") : now.clone().endOf("month");

  // Fetch raw data
  const [trades, journals, ruleStates] = await Promise.all([
    Trade.find({
      user: user._id,
      date: { $gte: start.toDate(), $lte: end.toDate() },
    }).lean(),
    Journal.find({
      user: user._id,
      date: { $gte: start.toDate(), $lte: end.toDate() },
    }).lean(),
    RuleState.find({
      user: user._id,
      date: { $gte: start.toDate(), $lte: end.toDate() },
    })
      .populate("rule", "description")
      .lean(),
  ]);

  // Initialize weekly/daily structure
  const detailed = {};
  let current = start.clone();
  while (current.isSameOrBefore(end)) {
    const dateStr = current.format("YYYY-MM-DD");
    detailed[dateStr] = {
      tradesTaken: 0,
      closedTrades: 0,
      rulesFollowed: 0,
      rulesUnfollowed: 0,
      totalRules: 0,
      totalProfitLoss: 0,
      winTrades: 0,
      lossTrades: 0,
      winRate: 0,
      wordsJournaled: 0,
      hasSmallTrade: false,
      ruleFollowingPercentage: 0,
      hasInteraction: false,
    };
    current.add(1, "day");
  }

  // Process trades
  trades.forEach((t) => {
    const dateStr = formatDate(t.date);
    const day = detailed[dateStr];
    if (!day) return;

    day.hasInteraction = true;
    day.tradesTaken++;

    if (t.action === "both" && t.sellingPrice && t.buyingPrice) {
      day.closedTrades++;
      const pnl =
        (t.sellingPrice - t.buyingPrice) * t.quantity -
        (t.exchangeRate || 0) -
        (t.brokerage || 0);
      day.totalProfitLoss += pnl;
      if (pnl > 0) day.winTrades++;
      else if (pnl < 0) day.lossTrades++;
      if (Math.abs(pnl) < 100) day.hasSmallTrade = true;
    }
  });

  // Process journals
  journals.forEach((j) => {
    const dateStr = formatDate(j.date);
    if (detailed[dateStr]) {
      detailed[dateStr].hasInteraction = true;

      const words = (j.note + " " + j.mistake + " " + j.lesson)
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      detailed[dateStr].wordsJournaled += words;
    }
  });

  // Final pass: compute rule stats using EXACT same logic as getWeeklyData
  for (const dateStr of Object.keys(detailed)) {
    const day = detailed[dateStr];
    const dateObj = normalizeDate(dateStr);

    // Filter RuleStates for this exact day
    const dayRuleStates = ruleStates.filter(
      (rs) => formatDate(rs.date) === dateStr && rs.isActive
    );

    // Only count rule interaction if user explicitly FOLLOWED at least one rule that day
    const hasRuleFollowed = dayRuleStates.some((rs) => rs.isFollowed === true);

    day.hasInteraction = day.hasInteraction || hasRuleFollowed;

    if (day.hasInteraction) {
      // THIS IS THE KEY: use getEffectiveRulesForDate — same as weekly endpoint
      const effectiveRules = await getEffectiveRulesForDate(user._id, dateObj);

      day.totalRules = effectiveRules.length;
      day.rulesFollowed = dayRuleStates.filter((rs) => rs.isFollowed).length;
      day.rulesUnfollowed = day.totalRules - day.rulesFollowed;
    } else {
      day.totalRules = 0;
      day.rulesFollowed = 0;
      day.rulesUnfollowed = 0;
    }

    // Final calculations
    day.winRate =
      day.closedTrades > 0
        ? Number(((day.winTrades / day.closedTrades) * 100).toFixed(2))
        : 0;

    day.ruleFollowingPercentage =
      day.totalRules > 0
        ? Number(((day.rulesFollowed / day.totalRules) * 100).toFixed(2))
        : 0;
  }

  // Build overall summary
  let overallTradesTaken = 0;
  let overallClosedTrades = 0;
  let overallRulesFollowed = 0;
  let overallRulesUnfollowed = 0;
  let overallProfitLoss = 0;
  let overallWinTrades = 0;
  let overallLossTrades = 0;
  let overallWordsJournaled = 0;

  Object.values(detailed).forEach((d) => {
    overallTradesTaken += d.tradesTaken;
    overallClosedTrades += d.closedTrades;
    overallRulesFollowed += d.rulesFollowed;
    overallRulesUnfollowed += d.rulesUnfollowed;
    overallProfitLoss += d.totalProfitLoss;
    overallWinTrades += d.winTrades;
    overallLossTrades += d.lossTrades;
    overallWordsJournaled += d.wordsJournaled;
  });

  const overallWinRate =
    overallClosedTrades > 0
      ? Number(((overallWinTrades / overallClosedTrades) * 100).toFixed(2))
      : 0;

  // Top rules
  const followed = {};
  const unfollowed = {};
  ruleStates.forEach((rs) => {
    const desc = rs.rule?.description;
    if (!desc) return;
    if (rs.isFollowed) followed[desc] = (followed[desc] || 0) + 1;
    else unfollowed[desc] = (unfollowed[desc] || 0) + 1;
  });

  const topFollowedRules = Object.entries(followed)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([rule, followedCount]) => ({ rule, followedCount }));

  const topUnfollowedRules = Object.entries(unfollowed)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([rule, unfollowedCount]) => ({ rule, unfollowedCount }));

  // Profit/loss/breakeven summary
  const profitDays = {
    count: 0,
    rulesFollowed: 0,
    tradesTaken: 0,
    winTrades: 0,
    wordsJournaled: 0,
  };
  const lossDays = {
    count: 0,
    rulesFollowed: 0,
    tradesTaken: 0,
    winTrades: 0,
    wordsJournaled: 0,
  };
  const breakEvenDays = {
    count: 0,
    rulesFollowed: 0,
    tradesTaken: 0,
    winTrades: 0,
    wordsJournaled: 0,
  };

  Object.values(detailed).forEach((m) => {
    if (m.totalProfitLoss > 100) {
      profitDays.count++;
      profitDays.rulesFollowed += m.rulesFollowed;
      profitDays.tradesTaken += m.tradesTaken;
      profitDays.winTrades += m.winTrades;
      profitDays.wordsJournaled += m.wordsJournaled;
    } else if (m.totalProfitLoss < -100) {
      lossDays.count++;
      lossDays.rulesFollowed += m.rulesFollowed;
      lossDays.tradesTaken += m.tradesTaken;
      lossDays.winTrades += m.winTrades;
      lossDays.wordsJournaled += m.wordsJournaled;
    } else if (m.hasInteraction) {
      breakEvenDays.count++;
      breakEvenDays.rulesFollowed += m.rulesFollowed;
      breakEvenDays.tradesTaken += m.tradesTaken;
      breakEvenDays.winTrades += m.winTrades;
      breakEvenDays.wordsJournaled += m.wordsJournaled;
    }
  });

  const avg = (cat) => ({
    avgRulesFollowed:
      cat.count > 0
        ? Number(((cat.rulesFollowed / (cat.count * 10)) * 100).toFixed(2))
        : 0, // assuming 10 rules
    avgTradesTaken:
      cat.count > 0 ? Number((cat.tradesTaken / cat.count).toFixed(2)) : 0,
    winRate:
      cat.tradesTaken > 0
        ? Number(((cat.winTrades / cat.tradesTaken) * 100).toFixed(2))
        : 0,
    avgWordsJournaled:
      cat.count > 0 ? Number((cat.wordsJournaled / cat.count).toFixed(2)) : 0,
  });

  return {
    overall: {
      capital: dataToShare.capital ? user.capital : undefined,
      currentPoints: dataToShare.currentPoints ? user.points : undefined,
      tradesTaken: dataToShare.tradesTaken ? overallTradesTaken : 0,
      rulesFollowed: dataToShare.rulesFollowed ? overallRulesFollowed : 0,
      rulesUnfollowed: dataToShare.rulesFollowed ? overallRulesUnfollowed : 0,
      totalProfitLoss: dataToShare.profitLoss
        ? Number(overallProfitLoss.toFixed(2))
        : 0,
      winTrades: dataToShare.winRate ? overallWinTrades : 0,
      lossTrades: dataToShare.winRate ? overallLossTrades : 0,
      wordsJournaled: overallWordsJournaled,
      winRate: dataToShare.winRate ? overallWinRate : 0,
      profitLossSummary: {
        profit_days: avg(profitDays),
        loss_days: avg(lossDays),
        breakEven_days: avg(breakEvenDays),
      },
      topFollowedRules: dataToShare.rulesFollowed ? topFollowedRules : [],
      topUnfollowedRules: dataToShare.rulesFollowed ? topUnfollowedRules : [],
    },
    detailed,
    sharedDates: Object.keys(detailed).sort(),
    apName: partner.name,
    userName: user.name || user.email,
    dataSentAt: new Date(),
    dataRange: {
      frequency: shareFrequency,
      start: start.toDate(),
      end: end.toDate(),
    },
  };
};

// =======================================================================
// GET SHARED DATA (Partner View)
// =======================================================================
exports.getSharedData = async (req, res) => {
  try {
    const data = await generateSharedData(req.accountabilityPartner._id);
    res.json(data);
  } catch (error) {
    console.error("getSharedData error:", error);
    res.status(500).json({ error: "Failed to generate data" });
  }
};

// =======================================================================
// VERIFY PARTNER (via email link)
// =======================================================================
exports.verifyAccountabilityPartner = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token required" });

    const { userId, apId } = jwt.verify(token, process.env.JWT_SECRET);
    const partner = await AccountabilityPartner.findOne({
      _id: apId,
      user: userId,
    });
    if (!partner) return res.status(404).json({ error: "Invalid link" });

    if (!partner.isVerified) {
      partner.isVerified = true;
      await partner.save();
    }

    res.json({ message: "Verified successfully" });
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token" });
    }
    res.status(500).json({ error: "Server error" });
  }
};

// =======================================================================
// MANUAL: SEND EMAIL TO ONE PARTNER
// =======================================================================
exports.sendEmailToPartner = async (req, res) => {
  try {
    const partner = await AccountabilityPartner.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!partner) return res.status(404).json({ error: "Partner not found" });

    await sendAccountabilityEmail(partner);
    res.json({ success: true, message: "Email sent" });
  } catch (error) {
    res.status(500).json({ error: "Failed to send email" });
  }
};

// =======================================================================
// MANUAL: SEND TEST EMAIL TO ALL PARTNERS
// =======================================================================
exports.sendTestEmailsToAll = async (req, res) => {
  try {
    const partners = await AccountabilityPartner.find({ user: req.user._id });
    const results = [];

    for (const p of partners) {
      try {
        await sendAccountabilityEmail(p);
        results.push({ id: p._id, email: p.email, status: "sent" });
      } catch (err) {
        results.push({
          id: p._id,
          email: p.email,
          status: "failed",
          error: err.message,
        });
      }
    }

    res.json({ message: "Test complete", results });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = exports;
