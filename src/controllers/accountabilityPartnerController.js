const jwt = require("jsonwebtoken");
const AccountabilityPartner = require("../models/AccountabilityPartner");
const User = require("../models/User");
const Capital = require("../models/Capital");
const Trade = require("../models/Trade");
const Rule = require("../models/Rule");
const Journal = require("../models/Journal");
const nodemailer = require("nodemailer");
const emailService = require("../services/emailService");
const moment = require("moment");
const { calculateDateRangeMetrics } = require("./metricsController");

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

exports.getSharedData = async (req, res) => {
  try {
    const { dataToShare, shareFrequency } = req.accountabilityPartner;
    const endDate = moment().endOf("day");
    let startDate;

    if (shareFrequency === "weekly") {
      // Ensure we start from Monday of the current week
      startDate = moment(endDate).startOf("isoWeek");
    } else {
      startDate = moment(endDate).subtract(1, "month").startOf("day");
    }

    const sharedData = {
      overall: {},
      detailed: {},
      sharedDates: [],
    };

    // Fetch AP name and user name
    const ap = await AccountabilityPartner.findById(
      req.accountabilityPartner._id
    ).populate("user", "name");
    sharedData.apName = ap.name;
    sharedData.userName = ap.user.name;

    if (dataToShare.capital) {
      sharedData.overall.capital = req.user.capital;
    }

    if (dataToShare.currentPoints) {
      sharedData.overall.currentPoints = req.user.points;
    }

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
    });

    const journals = await Journal.find({
      user: req.user._id,
      date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
    });

    const rules = await Rule.find({ user: req.user._id });

    // Function to aggregate data for a specific date
    const aggregateData = (date) => {
      const dayTrades = trades.filter((trade) =>
        moment(trade.date).isSame(date, "day")
      );
      const dayJournal = journals.find((journal) =>
        moment(journal.date).isSame(date, "day")
      );

      const winTrades = dayTrades.filter((trade) => trade.netPnL > 0);
      const lossTrades = dayTrades.filter((trade) => trade.netPnL <= 0);

      // Calculate words journaled - similar to getDateRangeMetrics
      const wordsJournaled = dayJournal
        ? (
            (dayJournal.note || "") +
            " " +
            (dayJournal.mistake || "") +
            " " +
            (dayJournal.lesson || "")
          ).split(/\s+/).length
        : 0;

      return {
        tradesTaken: dayTrades.length,
        rulesFollowed: dayJournal ? dayJournal.rulesFollowed.length : 0,
        rulesUnfollowed: dayJournal ? dayJournal.rulesUnfollowed.length : 0,
        totalProfitLoss: dayTrades.reduce(
          (sum, trade) => sum + trade.netPnL,
          0
        ),
        winTrades: winTrades.length,
        lossTrades: lossTrades.length,
        winRate:
          dayTrades.length > 0
            ? (winTrades.length / dayTrades.length) * 100
            : 0,
        wordsJournaled,
      };
    };

    // Aggregate data for each day in the date range
    let currentDate = moment(startDate);
    const daysToAggregate =
      shareFrequency === "weekly"
        ? 7
        : moment(endDate).diff(startDate, "days") + 1;

    for (let i = 0; i < daysToAggregate; i++) {
      const dateString = currentDate.format("YYYY-MM-DD");
      sharedData.detailed[dateString] = aggregateData(currentDate);
      sharedData.sharedDates.push(dateString);
      currentDate.add(1, "day");
    }

    // Calculate overall metrics
    const overallMetrics = Object.values(sharedData.detailed).reduce(
      (acc, day) => {
        acc.tradesTaken += day.tradesTaken;
        acc.rulesFollowed += day.rulesFollowed;
        acc.rulesUnfollowed += day.rulesUnfollowed;
        acc.totalProfitLoss += day.totalProfitLoss;
        acc.winTrades += day.winTrades;
        acc.lossTrades += day.lossTrades;
        acc.wordsJournaled += day.wordsJournaled;
        return acc;
      },
      {
        tradesTaken: 0,
        rulesFollowed: 0,
        rulesUnfollowed: 0,
        totalProfitLoss: 0,
        winTrades: 0,
        lossTrades: 0,
        wordsJournaled: 0,
      }
    );

    sharedData.overall = {
      ...sharedData.overall,
      ...overallMetrics,
      winRate:
        overallMetrics.tradesTaken > 0
          ? (overallMetrics.winTrades / overallMetrics.tradesTaken) * 100
          : 0,
    };

    // Calculate profit, loss, and breakeven days
    const profitDays = Object.values(sharedData.detailed).filter(
      (day) => day.totalProfitLoss > 100
    );
    const lossDays = Object.values(sharedData.detailed).filter(
      (day) => day.totalProfitLoss < -100
    );
    const breakEvenDays = Object.values(sharedData.detailed).filter(
      (day) => Math.abs(day.totalProfitLoss) <= 100
    );

    const calculateAverage = (days, key) => {
      return days.length > 0
        ? days.reduce((sum, day) => sum + day[key], 0) / days.length
        : 0;
    };

    const totalRules = rules.length;

    sharedData.overall.profitLossSummary = {
      profit_days: {
        avgRulesFollowed:
          (calculateAverage(profitDays, "rulesFollowed") / totalRules) * 100,
        avgTradesTaken: calculateAverage(profitDays, "tradesTaken"),
        winRate: calculateAverage(profitDays, "winRate"),
        avgWordsJournaled: calculateAverage(profitDays, "wordsJournaled"),
      },
      loss_days: {
        avgRulesFollowed:
          (calculateAverage(lossDays, "rulesFollowed") / totalRules) * 100,
        avgTradesTaken: calculateAverage(lossDays, "tradesTaken"),
        winRate: calculateAverage(lossDays, "winRate"),
        avgWordsJournaled: calculateAverage(lossDays, "wordsJournaled"),
      },
      breakEven_days: {
        avgRulesFollowed:
          (calculateAverage(breakEvenDays, "rulesFollowed") / totalRules) * 100,
        avgTradesTaken: calculateAverage(breakEvenDays, "tradesTaken"),
        winRate: calculateAverage(breakEvenDays, "winRate"),
        avgWordsJournaled: calculateAverage(breakEvenDays, "wordsJournaled"),
      },
    };

    // Calculate top followed and unfollowed rules
    const ruleCount = {};
    journals.forEach((journal) => {
      journal.rulesFollowed.forEach((rule) => {
        ruleCount[rule.description] = ruleCount[rule.description] || {
          followed: 0,
          unfollowed: 0,
        };
        ruleCount[rule.description].followed++;
      });
      journal.rulesUnfollowed.forEach((rule) => {
        ruleCount[rule.description] = ruleCount[rule.description] || {
          followed: 0,
          unfollowed: 0,
        };
        ruleCount[rule.description].unfollowed++;
      });
    });

    const sortRules = (rules, key) =>
      Object.entries(rules)
        .sort((a, b) => b[1][key] - a[1][key])
        .slice(0, 5)
        .map(([rule, counts]) => ({ rule, [`${key}Count`]: counts[key] }));

    sharedData.overall.topFollowedRules = sortRules(ruleCount, "followed");
    sharedData.overall.topUnfollowedRules = sortRules(ruleCount, "unfollowed");

    if (dataToShare.dateRangeMetrics) {
      sharedData.overall.dateRangeMetrics = await calculateDateRangeMetrics(
        req.user._id,
        startDate.toDate(),
        endDate.toDate()
      );
    }

    // Add the date when the data is being sent
    sharedData.dataSentAt = new Date();

    // Add information about the time range
    sharedData.dataRange = {
      frequency: shareFrequency,
      startDate: startDate.toDate(),
      endDate: endDate.toDate(),
    };

    res.send(sharedData);
  } catch (error) {
    console.error("Error in getSharedData:", error);
    res
      .status(500)
      .send({ error: "An error occurred while fetching shared data" });
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

async function generateSharedData(userId, dataToShare, date) {
  const user = await User.findById(userId);
  const endDate = moment(date).endOf("day").toDate();
  const startDate = moment(endDate)
    .subtract(1, dataToShare.shareFrequency === "weekly" ? "week" : "month")
    .startOf("day")
    .toDate();

  let sharedData = {};

  if (dataToShare.capital) {
    const capital = await Capital.findOne({
      user: userId,
      date: { $lte: endDate },
    }).sort({ date: -1 });
    sharedData.capital = capital ? capital.amount : 0;
  }

  if (dataToShare.currentPoints) {
    sharedData.currentPoints = user.points;
  }

  const trades = await Trade.find({
    user: userId,
    date: { $gte: startDate, $lte: endDate },
  });
  const journals = await Journal.find({
    user: userId,
    date: { $gte: startDate, $lte: endDate },
  });

  if (dataToShare.rulesFollowed) {
    sharedData.rulesFollowed = journals.reduce(
      (sum, journal) => sum + journal.rulesFollowed.length,
      0
    );
  }

  if (
    dataToShare.winRate ||
    dataToShare.tradesTaken ||
    dataToShare.profitLoss
  ) {
    const winningTrades = trades.filter((trade) => trade.netPnL > 0);
    sharedData.winRate =
      trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    sharedData.tradesTaken = trades.length;
    sharedData.profitLoss = trades.reduce(
      (sum, trade) => sum + trade.netPnL,
      0
    );
  }

  if (dataToShare.dateRangeMetrics) {
    // Reuse the logic from metricsController.getDateRangeMetrics
    // You may need to refactor that function to make it reusable here
    sharedData.dateRangeMetrics = await calculateDateRangeMetrics(
      userId,
      startDate,
      endDate
    );
  }

  return sharedData;
}

async function sendAccountabilityEmail(accountabilityPartner) {
  const sharedData = await generateSharedData(
    accountabilityPartner.user,
    accountabilityPartner.dataToShare,
    new Date()
  );

  await emailService.sendAccountabilityUpdate(
    accountabilityPartner,
    sharedData
  );
  accountabilityPartner.sharedDates.push(new Date());
  await accountabilityPartner.save();
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

    const results = [];
    for (const partner of partners) {
      try {
        await sendAccountabilityEmail(partner);
        results.push({
          partnerId: partner._id,
          status: "success",
        });
      } catch (partnerError) {
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
