const Journal = require("../models/Journal");
const Trade = require("../models/Trade");
const Rule = require("../models/Rule");
const RuleFollowed = require("../models/RuleFollowed");
const moment = require("moment");

exports.getDateRangeMetrics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = moment.utc(startDate).startOf("day");
    const end = moment.utc(endDate).endOf("day");

    const journals = await Journal.find({
      user: req.user._id,
      date: { $gte: start.toDate(), $lte: end.toDate() },
    });

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: start.toDate(), $lte: end.toDate() },
    });

    const rules = await Rule.find({ user: req.user._id });

    const rulesFollowed = await RuleFollowed.find({
      user: req.user._id,
      date: { $gte: start.toDate(), $lte: end.toDate() },
    });

    // If no data found, return empty object
    if (
      journals.length === 0 &&
      trades.length === 0 &&
      rulesFollowed.length === 0
    ) {
      return res.json({});
    }

    // Initialize metrics objects
    const profitDays = {
      count: 0,
      rulesFollowed: 0,
      totalRules: 0,
      wordsJournaled: 0,
      tradesTaken: 0,
      winTrades: 0,
    };
    const lossDays = {
      count: 0,
      rulesFollowed: 0,
      totalRules: 0,
      wordsJournaled: 0,
      tradesTaken: 0,
      winTrades: 0,
    };
    const breakEvenDays = {
      count: 0,
      rulesFollowed: 0,
      totalRules: 0,
      wordsJournaled: 0,
      tradesTaken: 0,
      winTrades: 0,
    };

    // Calculate metrics for each day
    const dailyMetrics = {};
    const daysWithActivity = new Set();

    journals.forEach((journal) => {
      const dateStr = moment.utc(journal.date).format("YYYY-MM-DD");
      daysWithActivity.add(dateStr);
      dailyMetrics[dateStr] = {
        rulesFollowed: 0,
        wordsJournaled: (
          journal.note +
          " " +
          journal.mistake +
          " " +
          journal.lesson
        ).split(/\s+/).length,
        tradesTaken: 0,
        profitOrLoss: 0,
        winTrades: 0,
      };
    });

    trades.forEach((trade) => {
      const dateStr = moment.utc(trade.date).format("YYYY-MM-DD");
      daysWithActivity.add(dateStr);
      if (!dailyMetrics[dateStr]) {
        dailyMetrics[dateStr] = {
          rulesFollowed: 0,
          wordsJournaled: 0,
          tradesTaken: 0,
          profitOrLoss: 0,
          winTrades: 0,
        };
      }
      dailyMetrics[dateStr].tradesTaken++;
      const tradePnL =
        (trade.sellingPrice - trade.buyingPrice) * trade.quantity -
        (trade.exchangeRate + trade.brokerage);
      dailyMetrics[dateStr].profitOrLoss += tradePnL;
      if (tradePnL > 0) dailyMetrics[dateStr].winTrades++;
    });

    rulesFollowed.forEach((rf) => {
      const dateStr = moment.utc(rf.date).format("YYYY-MM-DD");
      if (dailyMetrics[dateStr] && rf.isFollowed) {
        dailyMetrics[dateStr].rulesFollowed++;
      }
    });

    // Categorize days and sum up metrics
    daysWithActivity.forEach((dateStr) => {
      const metric = dailyMetrics[dateStr];
      let category;
      if (metric.profitOrLoss > 100) {
        category = profitDays;
      } else if (metric.profitOrLoss < -100) {
        category = lossDays;
      } else {
        category = breakEvenDays;
      }
      category.count++;
      category.rulesFollowed += metric.rulesFollowed;
      category.totalRules += rules.length;
      category.wordsJournaled += metric.wordsJournaled;
      category.tradesTaken += metric.tradesTaken;
      category.winTrades += metric.winTrades;
    });

    // Calculate averages and rule following percentages
    const calculateAverages = (data) => ({
      avgRulesFollowed:
        data.totalRules > 0
          ? Number(((data.rulesFollowed / data.totalRules) * 100).toFixed(2))
          : 0,
      avgWordsJournaled:
        data.count > 0
          ? Number((data.wordsJournaled / data.count).toFixed(2))
          : 0,
      avgTradesTaken:
        data.count > 0 ? Number((data.tradesTaken / data.count).toFixed(2)) : 0,
      winRate:
        data.tradesTaken > 0
          ? Number(((data.winTrades / data.tradesTaken) * 100).toFixed(2))
          : 0,
    });

    // Calculate top followed and unfollowed rules
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
      .slice(0, 10)
      .map(([rule, count]) => ({ rule, count }));

    const topUnfollowedRules = Object.entries(ruleUnfollowedCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([rule, count]) => ({ rule, count }));

    res.json({
      profit_days: calculateAverages(profitDays),
      loss_days: calculateAverages(lossDays),
      breakEven_days: calculateAverages(breakEvenDays),
      topFollowedRules,
      topUnfollowedRules,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};



exports.getWeeklyData = async (req, res) => {
  try {
    const { date } = req.query;
    const givenDate = moment.utc(date);
    const startOfWeek = givenDate.clone().startOf("isoWeek");
    const endOfWeek = givenDate.clone().endOf("isoWeek");

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startOfWeek.toDate(), $lte: endOfWeek.toDate() },
    });

    const journals = await Journal.find({
      user: req.user._id,
      date: { $gte: startOfWeek.toDate(), $lte: endOfWeek.toDate() },
    });

    const rules = await Rule.find({ user: req.user._id });

    const rulesFollowed = await RuleFollowed.find({
      user: req.user._id,
      date: { $gte: startOfWeek.toDate(), $lte: endOfWeek.toDate() },
    });

    const weeklyData = {};

    for (let i = 0; i < 7; i++) {
      const currentDate = startOfWeek.clone().add(i, "days");
      const dateStr = currentDate.format("YYYY-MM-DD");
      weeklyData[dateStr] = {
        tradesTaken: 0,
        rulesFollowed: 0,
        rulesUnfollowed: 0,
        totalRules: rules.length,
        totalProfitLoss: 0,
        winTrades: 0,
        lossTrades: 0,
        winRate: 0,
      };
    }

    trades.forEach((trade) => {
      const dateStr = moment.utc(trade.date).format("YYYY-MM-DD");
      weeklyData[dateStr].tradesTaken++;
      const tradePnL =
        (trade.sellingPrice - trade.buyingPrice) * trade.quantity -
        (trade.exchangeRate + trade.brokerage);
      weeklyData[dateStr].totalProfitLoss += tradePnL;
      if (tradePnL > 0) {
        weeklyData[dateStr].winTrades++;
      } else if (tradePnL < 0) {
        weeklyData[dateStr].lossTrades++;
      }
    });

    journals.forEach((journal) => {
      const dateStr = moment.utc(journal.date).format("YYYY-MM-DD");
      const dayRulesFollowed = rulesFollowed.filter((rf) =>
        moment.utc(rf.date).isSame(journal.date, "day")
      );
      weeklyData[dateStr].rulesFollowed = dayRulesFollowed.filter(
        (rf) => rf.isFollowed
      ).length;
      weeklyData[dateStr].rulesUnfollowed =
        rules.length - weeklyData[dateStr].rulesFollowed;
    });

    // Calculate win rate for each day
    Object.keys(weeklyData).forEach((dateStr) => {
      const dayData = weeklyData[dateStr];
      dayData.winRate =
        dayData.tradesTaken > 0
          ? Number(((dayData.winTrades / dayData.tradesTaken) * 100).toFixed(2))
          : 0;
    });

    res.json(weeklyData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMonthlyProfitLossDates = async (req, res) => {
  try {
    const { year, month } = req.query;
    const startOfMonth = moment.utc(`${year}-${month}-01`).startOf("month");
    const endOfMonth = moment.utc(startOfMonth).endOf("month");

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    const profitLossDates = {};
    trades.forEach((trade) => {
      const dateStr = moment.utc(trade.date).format("YYYY-MM-DD");
      const tradePnL =
        (trade.sellingPrice - trade.buyingPrice) * trade.quantity -
        (trade.exchangeRate + trade.brokerage);
      profitLossDates[dateStr] = (profitLossDates[dateStr] || 0) + tradePnL;
    });

    // Categorize each date based on the total profit/loss
    Object.keys(profitLossDates).forEach((dateStr) => {
      const dailyProfitLoss = profitLossDates[dateStr];
      if (dailyProfitLoss > 100) {
        profitLossDates[dateStr] = "profit";
      } else if (dailyProfitLoss < -100) {
        profitLossDates[dateStr] = "loss";
      } else {
        profitLossDates[dateStr] = "breakeven";
      }
    });

    res.json(profitLossDates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = exports;
