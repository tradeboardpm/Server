const jwt = require("jsonwebtoken");
const AccountabilityPartner = require("../models/AccountabilityPartner");
const User = require("../models/User");
const Trade = require("../models/Trade");
const Rule = require("../models/Rule");
const RuleState = require("../models/RuleState");
const Journal = require("../models/Journal");
const emailService = require("../services/emailService");
const moment = require("moment");

const sendAccountabilityEmail = async (accountabilityPartner) => {
  try {
    const sharedData = await generateSharedData(accountabilityPartner._id);
    await emailService.sendAccountabilityUpdate(accountabilityPartner, sharedData);
    accountabilityPartner.lastSharedDate = new Date();
    await accountabilityPartner.save();
  } catch (error) {
    console.error("Error in sendAccountabilityEmail:", error);
  }
};

exports.addAccountabilityPartner = async (req, res) => {
  try {
    const { name, email, relation, dataToShare, shareFrequency } = req.body;

    if (!name || !email || !dataToShare) {
      return res.status(400).json({
        success: false,
        error: "Name, email, and data to share are required",
      });
    }

    const existingPartnersCount = await AccountabilityPartner.countDocuments({
      user: req.user._id,
    });
    if (existingPartnersCount >= 5) {
      return res.status(400).json({
        success: false,
        error: "Maximum limit of 5 accountability partners reached",
      });
    }

    const existingPartner = await AccountabilityPartner.findOne({
      user: req.user._id,
      email,
    });
    if (existingPartner) {
      return res.status(400).json({
        success: false,
        error: "An accountability partner with this email already exists",
      });
    }

    const accountabilityPartner = new AccountabilityPartner({
      user: req.user._id,
      name,
      email,
      relation,
      dataToShare,
      shareFrequency,
    });
    await accountabilityPartner.save();

    try {
      await emailService.sendNewPartnerEmail(req.user, accountabilityPartner);
    } catch (emailError) {
      console.error("Failed to send new partner email:", emailError);
    }

    try {
      await scheduleAccountabilityEmail(accountabilityPartner);
    } catch (scheduleError) {
      console.error("Failed to schedule accountability email:", scheduleError);
    }

    res.status(201).json({
      success: true,
      data: accountabilityPartner,
    });
  } catch (error) {
    console.error("Add AP error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

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
    const isValidOperation = updates.every((update) =>
      allowedUpdates.includes(update)
    );

    if (!isValidOperation) {
      return res.status(400).json({
        success: false,
        error: "Invalid updates",
      });
    }

    const accountabilityPartner = await AccountabilityPartner.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!accountabilityPartner) {
      return res.status(404).json({
        success: false,
        error: "Accountability partner not found",
      });
    }

    updates.forEach(
      (update) => (accountabilityPartner[update] = req.body[update])
    );
    await accountabilityPartner.save();

    if (updates.includes("shareFrequency")) {
      await scheduleAccountabilityEmail(accountabilityPartner);
    }

    res.status(200).json({
      success: true,
      data: accountabilityPartner,
    });
  } catch (error) {
    console.error("Update AP error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

exports.getAccountabilityPartners = async (req, res) => {
  try {
    const accountabilityPartners = await AccountabilityPartner.find({
      user: req.user._id,
    });
    res.status(200).json({
      success: true,
      data: accountabilityPartners || [],
    });
  } catch (error) {
    console.error("Get APs error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

exports.deleteAccountabilityPartner = async (req, res) => {
  try {
    const accountabilityPartner = await AccountabilityPartner.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!accountabilityPartner) {
      return res.status(404).json({
        success: false,
        error: "Accountability partner not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        _id: accountabilityPartner._id,
        message: "Accountability partner deleted successfully",
      },
    });
  } catch (error) {
    console.error("Delete AP error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

const calculateDateRangeMetrics = async (userId, startDate, endDate) => {
  const trades = await Trade.find({
    user: userId,
    date: { $gte: startDate, $lte: endDate },
  });

  const journals = await Journal.find({
    user: userId,
    date: { $gte: startDate, $lte: endDate },
  });

  const rules = await Rule.find({ user: userId });

  const ruleStates = await RuleState.find({
    user: userId,
    date: { $gte: startDate, $lte: endDate },
    isActive: true,
  }).populate("rule");

  const dailyMetrics = {};
  const overallMetrics = {
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

  let currentDate = moment(startDate);
  while (currentDate <= moment(endDate)) {
    const dateStr = currentDate.format("YYYY-MM-DD");
    dailyMetrics[dateStr] = {
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
    currentDate.add(1, "days");
  }

  trades.forEach((trade) => {
    const dateStr = moment(trade.date).format("YYYY-MM-DD");
    dailyMetrics[dateStr].tradesTaken++;
    overallMetrics.tradesTaken++;
    // Only calculate profit/loss for closed trades (action === "both")
    if (trade.action === "both") {
      const tradePnL =
        (trade.sellingPrice - trade.buyingPrice) * trade.quantity -
        (trade.exchangeRate + trade.brokerage);
      dailyMetrics[dateStr].totalProfitLoss += tradePnL;
      overallMetrics.totalProfitLoss += tradePnL;

      if (tradePnL > 0) {
        dailyMetrics[dateStr].winTrades++;
        overallMetrics.winTrades++;
      } else if (tradePnL < 0) {
        dailyMetrics[dateStr].lossTrades++;
        overallMetrics.lossTrades++;
      }

      if (Math.abs(tradePnL) < 100) {
        dailyMetrics[dateStr].hasSmallTrade = true;
      }
    }
  });

  journals.forEach((journal) => {
    const dateStr = moment(journal.date).format("YYYY-MM-DD");
    const wordsJournaled = (
      journal.note +
      " " +
      journal.mistake +
      " " +
      journal.lesson
    ).split(/\s+/).length;
    dailyMetrics[dateStr].wordsJournaled += wordsJournaled;
    overallMetrics.wordsJournaled += wordsJournaled;
  });

  ruleStates.forEach((rs) => {
    const dateStr = moment(rs.date).format("YYYY-MM-DD");
    if (rs.isFollowed) {
      dailyMetrics[dateStr].rulesFollowed++;
      overallMetrics.rulesFollowed++;
    } else {
      dailyMetrics[dateStr].rulesUnfollowed++;
      overallMetrics.rulesUnfollowed++;
    }
  });

  Object.keys(dailyMetrics).forEach((dateStr) => {
    const metrics = dailyMetrics[dateStr];
    metrics.winRate =
      metrics.tradesTaken > 0
        ? (metrics.winTrades / metrics.tradesTaken) * 100
        : 0;

    const isBreakEvenCondition =
      metrics.rulesFollowed > 0 ||
      metrics.hasSmallTrade ||
      metrics.wordsJournaled > 0;

    if (metrics.totalProfitLoss > 100 && !isBreakEvenCondition) {
      profitDays.count++;
      profitDays.rulesFollowed += metrics.rulesFollowed;
      profitDays.tradesTaken += metrics.tradesTaken;
      profitDays.winTrades += metrics.winTrades;
      profitDays.wordsJournaled += metrics.wordsJournaled;
    } else if (metrics.totalProfitLoss < -100 && !isBreakEvenCondition) {
      lossDays.count++;
      lossDays.rulesFollowed += metrics.rulesFollowed;
      lossDays.tradesTaken += metrics.tradesTaken;
      lossDays.winTrades += metrics.winTrades;
      lossDays.wordsJournaled += metrics.wordsJournaled;
    } else {
      breakEvenDays.count++;
      breakEvenDays.rulesFollowed += metrics.rulesFollowed;
      breakEvenDays.tradesTaken += metrics.tradesTaken;
      breakEvenDays.winTrades += metrics.winTrades;
      breakEvenDays.wordsJournaled += metrics.wordsJournaled;
    }
  });

  const calculateAverage = (data) => ({
    avgRulesFollowed:
      data.count > 0
        ? (data.rulesFollowed / (data.count * rules.length)) * 100
        : 0,
    avgTradesTaken: data.count > 0 ? data.tradesTaken / data.count : 0,
    winRate:
      data.tradesTaken > 0 ? (data.winTrades / data.tradesTaken) * 100 : 0,
    avgWordsJournaled: data.count > 0 ? data.wordsJournaled / data.count : 0,
  });

  const ruleFollowedCount = {};
  const ruleUnfollowedCount = {};
  ruleStates.forEach((rs) => {
    const rule = rs.rule;
    if (rule) {
      if (rs.isFollowed) {
        ruleFollowedCount[rule.description] =
          (ruleFollowedCount[rule.description] || 0) + 1;
      } else {
        ruleUnfollowedCount[rule.description] =
          (ruleUnfollowedCount[rule.description] || 0) + 1;
      }
    }
  });

  const topFollowedRules = Object.entries(ruleFollowedCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rule, count]) => ({ rule, followedCount: count }));

  const topUnfollowedRules = Object.entries(ruleUnfollowedCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rule, count]) => ({ rule, unfollowedCount: count }));

  return {
    overall: {
      ...overallMetrics,
      winRate:
        overallMetrics.tradesTaken > 0
          ? (overallMetrics.winTrades / overallMetrics.tradesTaken) * 100
          : 0,
      profitLossSummary: {
        profit_days: calculateAverage(profitDays),
        loss_days: calculateAverage(lossDays),
        breakEven_days: calculateAverage(breakEvenDays),
      },
      topFollowedRules,
      topUnfollowedRules,
    },
    detailed: dailyMetrics,
    sharedDates: Object.keys(dailyMetrics),
  };
};

const generateSharedData = async (accountabilityPartnerId) => {
  const accountabilityPartner = await AccountabilityPartner.findById(
    accountabilityPartnerId
  );
  if (!accountabilityPartner) {
    throw new Error("Accountability partner not found");
  }

  const { dataToShare, shareFrequency } = accountabilityPartner;
  const user = await User.findById(accountabilityPartner.user);
  if (!user) {
    throw new Error("User not found");
  }

  const dateSentAt = moment();
  let startDate, endDate;

  if (shareFrequency === "weekly") {
    startDate = moment(dateSentAt).startOf("week");
    endDate = moment(dateSentAt).endOf("week");
  } else {
    startDate = moment(dateSentAt).startOf("month");
    endDate = moment(dateSentAt).endOf("month");
  }

  const metrics = await calculateDateRangeMetrics(
    user._id,
    startDate.toDate(),
    endDate.toDate()
  );

  let detailedMetrics = {};
  const rules = await Rule.find({ user: user._id });

  const trades = await Trade.find({
    user: user._id,
    date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
  });

  const journals = await Journal.find({
    user: user._id,
    date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
  });

  const ruleStates = await RuleState.find({
    user: user._id,
    date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
    isActive: true,
  }).populate("rule");

  let currentDate = moment(startDate);
  while (currentDate <= endDate) {
    const dateStr = currentDate.format("YYYY-MM-DD");
    detailedMetrics[dateStr] = {
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
    currentDate.add(1, "days");
  }

  trades.forEach((trade) => {
    const dateStr = moment(trade.date).format("YYYY-MM-DD");
    if (detailedMetrics[dateStr]) {
      detailedMetrics[dateStr].tradesTaken++;
      // Only calculate profit/loss for closed trades (action === "both")
      if (trade.action === "both") {
        const tradePnL =
          (trade.sellingPrice - trade.buyingPrice) * trade.quantity -
          (trade.exchangeRate + trade.brokerage);
        detailedMetrics[dateStr].totalProfitLoss += tradePnL;

        if (tradePnL > 0) {
          detailedMetrics[dateStr].winTrades++;
        } else if (tradePnL < 0) {
          detailedMetrics[dateStr].lossTrades++;
        }

        if (Math.abs(tradePnL) < 100) {
          detailedMetrics[dateStr].hasSmallTrade = true;
        }
      }
    }
  });

  journals.forEach((journal) => {
    const dateStr = moment(journal.date).format("YYYY-MM-DD");
    if (detailedMetrics[dateStr]) {
      detailedMetrics[dateStr].wordsJournaled += (
        journal.note +
        " " +
        journal.mistake +
        " " +
        journal.lesson
      ).split(/\s+/).length;
    }
  });

  ruleStates.forEach((rs) => {
    const dateStr = moment(rs.date).format("YYYY-MM-DD");
    if (detailedMetrics[dateStr]) {
      if (rs.isFollowed) {
        detailedMetrics[dateStr].rulesFollowed++;
      } else {
        detailedMetrics[dateStr].rulesUnfollowed++;
      }
    }
  });

  Object.keys(detailedMetrics).forEach((dateStr) => {
    const metrics = detailedMetrics[dateStr];
    metrics.winRate =
      metrics.tradesTaken > 0
        ? Number(((metrics.winTrades / metrics.tradesTaken) * 100).toFixed(2))
        : 0;
    metrics.ruleFollowingPercentage =
      metrics.totalRules > 0
        ? Number(((metrics.rulesFollowed / metrics.totalRules) * 100).toFixed(2))
        : 0;
  });

  if (shareFrequency === "monthly") {
    const weeklyMetrics = {};
    Object.keys(detailedMetrics).forEach((dateStr) => {
      const weekNumber = moment(dateStr).week();
      const weekKey = `Week ${weekNumber}`;
      if (!weeklyMetrics[weekKey]) {
        weeklyMetrics[weekKey] = {
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
      }
      const dailyMetric = detailedMetrics[dateStr];
      Object.keys(dailyMetric).forEach((key) => {
        if (typeof dailyMetric[key] === "number") {
          weeklyMetrics[weekKey][key] += dailyMetric[key];
        } else if (key === "hasSmallTrade" && dailyMetric[key]) {
          weeklyMetrics[weekKey][key] = true;
        }
      });
    });

    Object.keys(weeklyMetrics).forEach((weekKey) => {
      const metrics = weeklyMetrics[weekKey];
      metrics.winRate =
        metrics.tradesTaken > 0
          ? Number(((metrics.winTrades / metrics.tradesTaken) * 100).toFixed(2))
          : 0;
      metrics.ruleFollowingPercentage =
        metrics.totalRules > 0
          ? Number(((metrics.rulesFollowed / metrics.totalRules) * 100).toFixed(2))
          : 0;
    });

    detailedMetrics = weeklyMetrics;
  }

  const sharedData = {
    overall: {
      capital: dataToShare.capital ? user.capital : undefined,
      currentPoints: dataToShare.currentPoints ? user.points : undefined,
      tradesTaken: dataToShare.tradesTaken ? metrics.overall.tradesTaken : 0,
      rulesFollowed: dataToShare.rulesFollowed
        ? metrics.overall.rulesFollowed
        : 0,
      rulesUnfollowed: dataToShare.rulesFollowed
        ? metrics.overall.rulesUnfollowed
        : 0, // Fixed line
      totalProfitLoss: dataToShare.profitLoss
        ? metrics.overall.totalProfitLoss
        : 0,
      winTrades: dataToShare.winRate ? metrics.overall.winTrades : 0,
      lossTrades: dataToShare.winRate ? metrics.overall.lossTrades : 0,
      wordsJournaled: metrics.overall.wordsJournaled,
      winRate: dataToShare.winRate ? metrics.overall.winRate : 0,
      profitLossSummary: metrics.overall.profitLossSummary,
      topFollowedRules: dataToShare.rulesFollowed
        ? metrics.overall.topFollowedRules
        : [],
      topUnfollowedRules: dataToShare.rulesFollowed
        ? metrics.overall.topUnfollowedRules
        : [],
    },
    detailed: detailedMetrics,
    periodicMetrics: detailedMetrics,
    sharedDates: Object.keys(detailedMetrics).sort(),
    apName: accountabilityPartner.name,
    userName: user.name,
    dataSentAt: new Date(),
    dataRange: {
      frequency: shareFrequency,
      startDate: startDate.toDate(),
      endDate: endDate.toDate(),
    },
  };

  return sharedData;
};

exports.getSharedData = async (req, res) => {
  try {
    const sharedData = await generateSharedData(req.accountabilityPartner._id);
    res.status(200).send(sharedData);
  } catch (error) {
    console.error("Error in getSharedData:", error);
    res
      .status(500)
      .send({ error: "Unable to fetch shared data. Please try again later." });
  }
};

exports.verifyAccountabilityPartner = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).send({ error: "Token is required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { userId, apId } = decoded;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }

    const accountabilityPartner = await AccountabilityPartner.findOne({
      _id: apId,
      user: userId,
    });

    if (!accountabilityPartner) {
      return res
        .status(404)
        .send({ error: "Accountability partner not found" });
    }

    if (!accountabilityPartner.isVerified) {
      accountabilityPartner.isVerified = true;
      await accountabilityPartner.save();
    }

    res
      .status(200)
      .send({ message: "Accountability partner verified successfully" });
  } catch (error) {
    console.error("Error in verifyAccountabilityPartner:", error);
    if (error.name === "JsonWebTokenError") {
      return res.status(401).send({ error: "Invalid token" });
    }
    res.status(500).send({ error: "An error occurred during verification" });
  }
};

const scheduleAccountabilityEmail = async (accountabilityPartner) => {
  const now = moment();
  let sendAt;

  if (accountabilityPartner.shareFrequency === "weekly") {
    sendAt = now.endOf("week").toDate();
  } else if (accountabilityPartner.shareFrequency === "monthly") {
    sendAt = now.endOf("month").toDate();
  }

  if (sendAt) {
    try {
      const sharedData = await generateSharedData(accountabilityPartner._id);
      await emailService.sendAccountabilityUpdate(
        accountabilityPartner,
        sharedData,
        sendAt
      );
      accountabilityPartner.lastSharedDate = sendAt;
      await accountabilityPartner.save();
    } catch (error) {
      console.error("Error scheduling email:", error);
    }
  }
};

exports.sendScheduledEmails = async () => {
  const today = new Date();
  const isEndOfMonth =
    today.getDate() ===
    new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const isWeekly = today.getDay() === 0;

  const partners = await AccountabilityPartner.find({
    $or: [
      {
        shareFrequency: "weekly",
        lastSharedDate: { $lt: moment().subtract(1, "week").toDate() },
      },
      {
        shareFrequency: "monthly",
        lastSharedDate: { $lt: moment().subtract(1, "month").toDate() },
      },
    ],
  });

  for (const partner of partners) {
    if (
      (partner.shareFrequency === "weekly" && isWeekly) ||
      (partner.shareFrequency === "monthly" && isEndOfMonth)
    ) {
      await sendAccountabilityEmail(partner);
    }
  }
};

exports.sendTestScheduledEmails = async (req, res) => {
  try {
    const partners = await AccountabilityPartner.find();
    const results = [];

    for (const partner of partners) {
      try {
        await sendAccountabilityEmail(partner);
        results.push({
          partnerId: partner._id,
          status: "success",
        });
      } catch (partnerError) {
        console.error("Error for partner:", partner._id, partnerError);
        results.push({
          partnerId: partner._id,
          status: "failed",
          error: partnerError.message,
        });
      }
    }

    res.status(200).send({
      message: "Scheduled emails processed",
      results,
    });
  } catch (error) {
    console.error("Error sending scheduled emails:", error);
    res.status(500).send({
      error: "Failed to send scheduled emails",
      details: error.message,
    });
  }
};

module.exports = exports;