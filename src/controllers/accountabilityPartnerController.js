const jwt = require("jsonwebtoken");
const AccountabilityPartner = require("../models/AccountabilityPartner");
const User = require("../models/User");
const Trade = require("../models/Trade");
const Rule = require("../models/Rule");
const RuleState = require("../models/RuleState");
const Journal = require("../models/Journal");
const emailService = require("../services/emailService");
const moment = require("moment");

// =======================================================================
// SEND ACCOUNTABILITY EMAIL + UPDATE lastSharedDate
// =======================================================================
const sendAccountabilityEmail = async (accountabilityPartner) => {
  try {
    const sharedData = await generateSharedData(accountabilityPartner._id);
    await emailService.sendAccountabilityUpdate(accountabilityPartner, sharedData);

    // Only update after successful send
    accountabilityPartner.lastSharedDate = new Date();
    await accountabilityPartner.save();

    console.log(`Accountability email sent to: ${accountabilityPartner.email}`);
  } catch (error) {
    console.error(`Failed to send email to ${accountabilityPartner.email}:`, error);
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
    const count = await AccountabilityPartner.countDocuments({ user: req.user._id });
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

  const profitDays = { count: 0, rulesFollowed: 0, tradesTaken: 0, winTrades: 0, wordsJournaled: 0 };
  const lossDays = { count: 0, rulesFollowed: 0, tradesTaken: 0, winTrades: 0, wordsJournaled: 0 };
  const breakEvenDays = { count: 0, rulesFollowed: 0, tradesTaken: 0, winTrades: 0, wordsJournaled: 0 };

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
      const pnl = (t.sellingPrice - t.buyingPrice) * t.quantity - (t.exchangeRate + t.brokerage);
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
    const words = (j.note + " " + j.mistake + " " + j.lesson).split(/\s+/).length;
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

    const isBreakEven = m.rulesFollowed > 0 || m.hasSmallTrade || m.wordsJournaled > 0;

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
    avgRulesFollowed: data.count > 0 ? (data.rulesFollowed / (data.count * rules.length)) * 100 : 0,
    avgTradesTaken: data.count > 0 ? data.tradesTaken / data.count : 0,
    winRate: data.tradesTaken > 0 ? (data.winTrades / data.tradesTaken) * 100 : 0,
    avgWordsJournaled: data.count > 0 ? data.wordsJournaled / data.count : 0,
  });

  // Top rules
  const followed = {};
  const unfollowed = {};
  ruleStates.forEach((rs) => {
    if (rs.rule) {
      const desc = rs.rule.description;
      rs.isFollowed ? (followed[desc] = (followed[desc] || 0) + 1) : (unfollowed[desc] = (unfollowed[desc] || 0) + 1);
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
      winRate: overall.tradesTaken > 0 ? (overall.winTrades / overall.tradesTaken) * 100 : 0,
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
// GENERATE SHARED DATA (for email + partner view)
// =======================================================================
const generateSharedData = async (partnerId) => {
  const partner = await AccountabilityPartner.findById(partnerId);
  if (!partner) throw new Error("Partner not found");

  const user = await User.findById(partner.user);
  if (!user) throw new Error("User not found");

  const { dataToShare, shareFrequency } = partner;
  const now = moment();
  const isWeekly = shareFrequency === "weekly";

  const start = isWeekly ? now.clone().startOf("week") : now.clone().startOf("month");
  const end = isWeekly ? now.clone().endOf("week") : now.clone().endOf("month");

  const metrics = await calculateDateRangeMetrics(user._id, start.toDate(), end.toDate());

  // Build detailed (daily or weekly)
  let detailed = {};
  const rules = await Rule.find({ user: user._id });

  const [trades, journals, ruleStates] = await Promise.all([
    Trade.find({ user: user._id, date: { $gte: start.toDate(), $lte: end.toDate() } }),
    Journal.find({ user: user._id, date: { $gte: start.toDate(), $lte: end.toDate() } }),
    RuleState.find({
      user: user._id,
      date: { $gte: start.toDate(), $lte: end.toDate() },
      isActive: true,
    }).populate("rule"),
  ]);

  let cur = moment(start);
  while (cur <= end) {
    const d = cur.format("YYYY-MM-DD");
    detailed[d] = {
      tradesTaken: 0,
      rulesFollowed: 0,
      rulesUnfollowed: 0,
      totalRules: rules.length,
      totalProfitLoss: 0,
      winTrades: 0,
      lossTrades: 0,
      winRate: 0,
      wordsJournaled: 0,
      hasSmallTrade: false,
    };
    cur.add(1, "day");
  }

  trades.forEach((t) => {
    const d = moment(t.date).format("YYYY-MM-DD");
    if (detailed[d] && t.action === "both") {
      const pnl = (t.sellingPrice - t.buyingPrice) * t.quantity - (t.exchangeRate + t.brokerage);
      detailed[d].totalProfitLoss += pnl;
      detailed[d].tradesTaken++;
      pnl > 0 ? detailed[d].winTrades++ : pnl < 0 ? detailed[d].lossTrades++ : null;
      if (Math.abs(pnl) < 100) detailed[d].hasSmallTrade = true;
    }
  });

  journals.forEach((j) => {
    const d = moment(j.date).format("YYYY-MM-DD");
    if (detailed[d]) {
      detailed[d].wordsJournaled += (j.note + " " + j.mistake + " " + j.lesson).split(/\s+/).length;
    }
  });

  ruleStates.forEach((rs) => {
    const d = moment(rs.date).format("YYYY-MM-DD");
    if (detailed[d]) {
      rs.isFollowed ? detailed[d].rulesFollowed++ : detailed[d].rulesUnfollowed++;
    }
  });

  Object.keys(detailed).forEach((d) => {
    const m = detailed[d];
    m.winRate = m.tradesTaken > 0 ? Number(((m.winTrades / m.tradesTaken) * 100).toFixed(2)) : 0;
    m.ruleFollowingPercentage = m.totalRules > 0 ? Number(((m.rulesFollowed / m.totalRules) * 100).toFixed(2)) : 0;
  });

  // Monthly: group by week
  if (!isWeekly) {
    const weekly = {};
    Object.keys(detailed).forEach((d) => {
      const wk = `Week ${moment(d).week()}`;
      if (!weekly[wk]) {
        weekly[wk] = { ...detailed[d], tradesTaken: 0, totalProfitLoss: 0, winTrades: 0, lossTrades: 0, wordsJournaled: 0, rulesFollowed: 0, rulesUnfollowed: 0, hasSmallTrade: false };
      }
      const dm = detailed[d];
      weekly[wk].tradesTaken += dm.tradesTaken;
      weekly[wk].totalProfitLoss += dm.totalProfitLoss;
      weekly[wk].winTrades += dm.winTrades;
      weekly[wk].lossTrades += dm.lossTrades;
      weekly[wk].wordsJournaled += dm.wordsJournaled;
      weekly[wk].rulesFollowed += dm.rulesFollowed;
      weekly[wk].rulesUnfollowed += dm.rulesUnfollowed;
      if (dm.hasSmallTrade) weekly[wk].hasSmallTrade = true;
    });
    Object.keys(weekly).forEach((k) => {
      const m = weekly[k];
      m.winRate = m.tradesTaken > 0 ? Number(((m.winTrades / m.tradesTaken) * 100).toFixed(2)) : 0;
      m.ruleFollowingPercentage = m.totalRules > 0 ? Number(((m.rulesFollowed / m.totalRules) * 100).toFixed(2)) : 0;
    });
    detailed = weekly;
  }

  return {
    overall: {
      capital: dataToShare.capital ? user.capital : undefined,
      currentPoints: dataToShare.currentPoints ? user.points : undefined,
      tradesTaken: dataToShare.tradesTaken ? metrics.overall.tradesTaken : 0,
      rulesFollowed: dataToShare.rulesFollowed ? metrics.overall.rulesFollowed : 0,
      rulesUnfollowed: dataToShare.rulesFollowed ? metrics.overall.rulesUnfollowed : 0,
      totalProfitLoss: dataToShare.profitLoss ? metrics.overall.totalProfitLoss : 0,
      winTrades: dataToShare.winRate ? metrics.overall.winTrades : 0,
      lossTrades: dataToShare.winRate ? metrics.overall.lossTrades : 0,
      wordsJournaled: metrics.overall.wordsJournaled,
      winRate: dataToShare.winRate ? metrics.overall.winRate : 0,
      profitLossSummary: metrics.overall.profitLossSummary,
      topFollowedRules: dataToShare.rulesFollowed ? metrics.overall.topFollowedRules : [],
      topUnfollowedRules: dataToShare.rulesFollowed ? metrics.overall.topUnfollowedRules : [],
    },
    detailed,
    sharedDates: Object.keys(detailed).sort(),
    apName: partner.name,
    userName: user.name,
    dataSentAt: new Date(),
    dataRange: { frequency: shareFrequency, start: start.toDate(), end: end.toDate() },
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
    const partner = await AccountabilityPartner.findOne({ _id: apId, user: userId });
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
        results.push({ id: p._id, email: p.email, status: "failed", error: err.message });
      }
    }

    res.json({ message: "Test complete", results });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = exports;