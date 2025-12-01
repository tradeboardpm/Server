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
// ADD ACCOUNTABILITY PARTNER
// =======================================================================
exports.addAccountabilityPartner = async (req, res) => {
  try {
    const { name, email, relation, dataToShare } = req.body;

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
    });
    await partner.save();

    // Send welcome email only
    try {
      await emailService.sendNewPartnerEmail(req.user, partner);
    } catch (err) {
      console.error("Welcome email failed:", err);
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
    const allowedUpdates = ["name", "email", "relation", "dataToShare"];

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
// generateSharedData – Shows CURRENT WEEK data based on access time
// =======================================================================

const generateSharedData = async (partnerId) => {
  const partner = await AccountabilityPartner.findById(partnerId);
  if (!partner) throw new Error("Partner not found");

  const user = await User.findById(partner.user);
  if (!user) throw new Error("User not found");

  const { dataToShare } = partner;

  // CURRENT MONTH instead of current week
  const now = moment().utc();
  const start = now.clone().startOf("month"); // 1st of current month
  const end = now.clone().endOf("month");     // Last day of current month

  // console.log(`[AP] Generating data for month: ${start.format("YYYY-MM-DD")} to ${end.format("YYYY-MM-DD")}`);

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

  // Initialize monthly structure
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

  // Process rules per day
  for (const dateStr of Object.keys(detailed)) {
    const day = detailed[dateStr];
    const dateObj = normalizeDate(dateStr);

    const dayRuleStates = ruleStates.filter(
      (rs) => formatDate(rs.date) === dateStr && rs.isActive
    );

    const hasRuleFollowed = dayRuleStates.some((rs) => rs.isFollowed === true);
    day.hasInteraction = day.hasInteraction || hasRuleFollowed;

    if (day.hasInteraction) {
      const effectiveRules = await getEffectiveRulesForDate(user._id, dateObj);
      day.totalRules = effectiveRules.length;
      day.rulesFollowed = dayRuleStates.filter((rs) => rs.isFollowed).length;
      day.rulesUnfollowed = day.totalRules - day.rulesFollowed;
    }

    day.winRate =
      day.closedTrades > 0
        ? Number(((day.winTrades / day.closedTrades) * 100).toFixed(2))
        : 0;

    day.ruleFollowingPercentage =
      day.totalRules > 0
        ? Number(((day.rulesFollowed / day.totalRules) * 100).toFixed(2))
        : 0;
  }

  // Overall monthly summary
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

  // Top rules this month
  const followed = {};
  const unfollowed = {};
  ruleStates.forEach((rs) => {
    const dateStr = formatDate(rs.date);
    const day = detailed[dateStr];

    if (day && day.hasInteraction && rs.rule?.description) {
      const desc = rs.rule.description;
      if (rs.isFollowed) {
        followed[desc] = (followed[desc] || 0) + 1;
      } else {
        unfollowed[desc] = (unfollowed[desc] || 0) + 1;
      }
    }
  });

  const topFollowedRules = Object.entries(followed)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([rule, followedCount]) => ({ rule, followedCount }));

  const topUnfollowedRules = Object.entries(unfollowed)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([rule, unfollowedCount]) => ({ rule, unfollowedCount }));

  // Profit/Loss/BE days summary
  const profitDays = { count: 0, rulesFollowed: 0, tradesTaken: 0, winTrades: 0, wordsJournaled: 0 };
  const lossDays = { count: 0, rulesFollowed: 0, tradesTaken: 0, winTrades: 0, wordsJournaled: 0 };
  const breakEvenDays = { count: 0, rulesFollowed: 0, tradesTaken: 0, winTrades: 0, wordsJournaled: 0 };

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
        ? Number(((cat.rulesFollowed / (cat.count * 10)) * 100).toFixed(2)) // assuming max 10 rules
        : 0,
    avgTradesTaken: cat.count > 0 ? Number((cat.tradesTaken / cat.count).toFixed(2)) : 0,
    winRate: cat.tradesTaken > 0 ? Number(((cat.winTrades / cat.tradesTaken) * 100).toFixed(2)) : 0,
    avgWordsJournaled: cat.count > 0 ? Number((cat.wordsJournaled / cat.count).toFixed(2)) : 0,
  });

  return {
    overall: {
      capital: dataToShare.capital ? user.capital : undefined,
      currentPoints: dataToShare.currentPoints ? user.points : undefined,
      tradesTaken: dataToShare.tradesTaken ? overallTradesTaken : 0,
      rulesFollowed: dataToShare.rulesFollowed ? overallRulesFollowed : 0,
      rulesUnfollowed: dataToShare.rulesFollowed ? overallRulesUnfollowed : 0,
      totalProfitLoss: dataToShare.profitLoss ? Number(overallProfitLoss.toFixed(2)) : 0,
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
    weekRange: { // Still called weekRange for backward compat, but it's actually month
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

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const partner = await AccountabilityPartner.findOne({
      _id: decoded.apId,
      user: decoded.userId,
    });

    if (!partner) return res.status(404).json({ error: "Invalid link" });

    if (!partner.isVerified) {
      partner.isVerified = true;
      await partner.save();
    }

    // Redirect to dashboard with same token
    res.json({
      success: true,
      redirectUrl: `/ap-data?token=${token}`
    });
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
};

module.exports = exports;
