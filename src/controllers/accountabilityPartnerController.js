const jwt = require("jsonwebtoken");
const AccountabilityPartner = require("../models/AccountabilityPartner");
const User = require("../models/User");
const Trade = require("../models/Trade");
const Rule = require("../models/Rule");
const RuleFollowed = require("../models/RuleFollowed");
const Journal = require("../models/Journal");
const emailService = require("../services/emailService");
const moment = require("moment");
// const { calculateDateRangeMetrics } = require("./metricsController");

exports.addAccountabilityPartner = async (req, res) => {
  try {
    const { name, email, relation, dataToShare, shareFrequency } = req.body;

    // Check if the user has reached the limit of 5 APs
    const existingPartnersCount = await AccountabilityPartner.countDocuments({
      user: req.user._id,
    });
    if (existingPartnersCount >= 5) {
      return res.status(400).send({
        error:
          "You have reached the maximum limit of 5 accountability partners.",
      });
    }

    // Check if the email is already in use for this user
    const existingPartner = await AccountabilityPartner.findOne({
      user: req.user._id,
      email,
    });
    if (existingPartner) {
      return res.status(400).send({
        error: "An accountability partner with this email already exists.",
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

    // Send email to the new accountability partner
    await emailService.sendNewPartnerEmail(req.user, accountabilityPartner);

    res.status(201).send(accountabilityPartner);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.getAccountabilityPartners = async (req, res) => {
  try {
    const accountabilityPartners = await AccountabilityPartner.find({
      user: req.user._id,
    });
    res.send(accountabilityPartners);
  } catch (error) {
    res.status(500).send({ error: error.message });
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
      return res.status(400).send({ error: "Invalid updates!" });
    }

    const accountabilityPartner = await AccountabilityPartner.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!accountabilityPartner) {
      return res
        .status(404)
        .send({ error: "Accountability partner not found" });
    }

    updates.forEach(
      (update) => (accountabilityPartner[update] = req.body[update])
    );
    await accountabilityPartner.save();
    res.send(accountabilityPartner);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.deleteAccountabilityPartner = async (req, res) => {
  try {
    const accountabilityPartner = await AccountabilityPartner.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!accountabilityPartner) {
      return res
        .status(404)
        .send({ error: "Accountability partner not found" });
    }

    res.send(accountabilityPartner);
  } catch (error) {
    res.status(500).send({ error: error.message });
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

  const rulesFollowed = await RuleFollowed.find({
    user: userId,
    date: { $gte: startDate, $lte: endDate },
  });

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
    };
    currentDate.add(1, "days");
  }

  trades.forEach((trade) => {
    const dateStr = moment(trade.date).format("YYYY-MM-DD");
    const tradePnL =
      (trade.sellingPrice - trade.buyingPrice) * trade.quantity -
      (trade.exchangeRate + trade.brokerage);

    dailyMetrics[dateStr].tradesTaken++;
    dailyMetrics[dateStr].totalProfitLoss += tradePnL;
    overallMetrics.tradesTaken++;
    overallMetrics.totalProfitLoss += tradePnL;

    if (tradePnL > 0) {
      dailyMetrics[dateStr].winTrades++;
      overallMetrics.winTrades++;
    } else if (tradePnL < 0) {
      dailyMetrics[dateStr].lossTrades++;
      overallMetrics.lossTrades++;
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

  rulesFollowed.forEach((rf) => {
    const dateStr = moment(rf.date).format("YYYY-MM-DD");
    if (rf.isFollowed) {
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

    if (metrics.totalProfitLoss > 100) {
      profitDays.count++;
      profitDays.rulesFollowed += metrics.rulesFollowed;
      profitDays.tradesTaken += metrics.tradesTaken;
      profitDays.winTrades += metrics.winTrades;
      profitDays.wordsJournaled += metrics.wordsJournaled;
    } else if (metrics.totalProfitLoss < -100) {
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
  rulesFollowed.forEach((rf) => {
    const rule = rules.find((r) => r._id.toString() === rf.rule.toString());
    if (rule) {
      if (rf.isFollowed) {
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

  // Use dateSentAt to determine the correct date range
  const dateSentAt = moment();
  let startDate, endDate;

  if (shareFrequency === "weekly") {
    // Get start and end of the current week
    startDate = moment(dateSentAt).startOf("week");
    endDate = moment(dateSentAt).endOf("week");
  } else {
    // Get start and end of the current month
    startDate = moment(dateSentAt).startOf("month");
    endDate = moment(dateSentAt).endOf("month");
  }

  const metrics = await calculateDateRangeMetrics(
    user._id,
    startDate.toDate(),
    endDate.toDate()
  );

  // Get detailed metrics for the time period
  const detailedMetrics = {};
  const rules = await Rule.find({ user: user._id });

  // Get all required data for the period
  const trades = await Trade.find({
    user: user._id,
    date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
  });

  const journals = await Journal.find({
    user: user._id,
    date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
  });

  const rulesFollowed = await RuleFollowed.find({
    user: user._id,
    date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
  });

  // Initialize metrics for each day in the period
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
    };
    currentDate.add(1, "days");
  }

  // Process trades
  trades.forEach((trade) => {
    const dateStr = moment(trade.date).format("YYYY-MM-DD");
    if (detailedMetrics[dateStr]) {
      detailedMetrics[dateStr].tradesTaken++;
      const tradePnL =
        (trade.sellingPrice - trade.buyingPrice) * trade.quantity -
        (trade.exchangeRate + trade.brokerage);
      detailedMetrics[dateStr].totalProfitLoss += tradePnL;

      if (tradePnL > 0) {
        detailedMetrics[dateStr].winTrades++;
      } else if (tradePnL < 0) {
        detailedMetrics[dateStr].lossTrades++;
      }
    }
  });

  // Process journals
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

  // Process rules followed
  rulesFollowed.forEach((rf) => {
    const dateStr = moment(rf.date).format("YYYY-MM-DD");
    if (detailedMetrics[dateStr]) {
      if (rf.isFollowed) {
        detailedMetrics[dateStr].rulesFollowed++;
      } else {
        detailedMetrics[dateStr].rulesUnfollowed++;
      }
    }
  });

  // Calculate win rates and rule following percentages
  Object.keys(detailedMetrics).forEach((dateStr) => {
    const metrics = detailedMetrics[dateStr];
    metrics.winRate =
      metrics.tradesTaken > 0
        ? Number(((metrics.winTrades / metrics.tradesTaken) * 100).toFixed(2))
        : 0;
    metrics.ruleFollowingPercentage =
      metrics.totalRules > 0
        ? Number(
            ((metrics.rulesFollowed / metrics.totalRules) * 100).toFixed(2)
          )
        : 0;
  });

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
        : 0,
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

    // If the AP is not yet verified, mark them as verified
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

async function sendAccountabilityEmail(accountabilityPartner) {
  try {
    console.log(
      "Sending email for accountability partner:",
      accountabilityPartner._id
    );

    const sharedData = await generateSharedData(accountabilityPartner._id);

    console.log("Shared data:", sharedData);

    await emailService.sendAccountabilityUpdate(
      accountabilityPartner,
      sharedData
    );

    accountabilityPartner.sharedDates.push(new Date());
    await accountabilityPartner.save();
  } catch (error) {
    console.error("Error in sendAccountabilityEmail:", error);
    throw error;
  }
}

exports.sendScheduledEmails = async () => {
  const today = new Date();
  const isEndOfMonth =
    today.getDate() ===
    new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const isWeekly = today.getDay() === 0; // Sunday

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
    console.log("Found accountability partners:", partners.length);

    const results = [];
    for (const partner of partners) {
      try {
        console.log("Processing partner:", partner._id);
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

    if (res) {
      res.status(200).send({
        message: "Scheduled emails processed",
        results,
      });
    }
  } catch (error) {
    console.error("Error sending scheduled emails:", error);
    if (res) {
      res.status(500).send({
        error: "Failed to send scheduled emails",
        details: error.message,
      });
    }
  }
};

module.exports = exports;
