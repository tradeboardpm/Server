const Journal = require("../models/Journal");
const Trade = require("../models/Trade");
const moment = require("moment");

async function calculateDateRangeMetrics(userId, startDate, endDate) {
  const start = moment(startDate).startOf("day");
  const end = moment(endDate).endOf("day");

  const journals = await Journal.find({
    user: userId,
    date: { $gte: start, $lte: end },
  });

  const trades = await Trade.find({
    user: userId,
    date: { $gte: start, $lte: end },
  });

  // Initialize metrics objects
  const profitDays = {
    count: 0,
    rulesFollowed: 0,
    wordsJournaled: 0,
    tradesTaken: 0,
    winTrades: 0,
  };
  const lossDays = {
    count: 0,
    rulesFollowed: 0,
    wordsJournaled: 0,
    tradesTaken: 0,
    winTrades: 0,
  };
  const breakEvenDays = {
    count: 0,
    rulesFollowed: 0,
    wordsJournaled: 0,
    tradesTaken: 0,
    winTrades: 0,
  };

  // Calculate metrics for each day
  const dailyMetrics = {};
  journals.forEach((journal) => {
    const dateStr = moment(journal.date).format("YYYY-MM-DD");
    dailyMetrics[dateStr] = {
      rulesFollowed: journal.rulesFollowed.length,
      wordsJournaled: (
        journal.note +
        " " +
        journal.mistake +
        " " +
        journal.lesson
      ).split(" ").length,
      tradesTaken: 0,
      profitOrLoss: 0,
      winTrades: 0,
    };
  });

  trades.forEach((trade) => {
    const dateStr = moment(trade.date).format("YYYY-MM-DD");
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
    dailyMetrics[dateStr].profitOrLoss += trade.profitOrLoss;
    if (trade.profitOrLoss > 0) dailyMetrics[dateStr].winTrades++;
  });

  // Categorize days and sum up metrics
  Object.values(dailyMetrics).forEach((metric) => {
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
    category.wordsJournaled += metric.wordsJournaled;
    category.tradesTaken += metric.tradesTaken;
    category.winTrades += metric.winTrades;
  });

  // Calculate averages
  const calculateAverages = (data) => ({
    avgRulesFollowed: data.count ? data.rulesFollowed / data.count : 0,
    avgWordsJournaled: data.count ? data.wordsJournaled / data.count : 0,
    avgTradesTaken: data.count ? data.tradesTaken / data.count : 0,
    winRate: data.tradesTaken ? (data.winTrades / data.tradesTaken) * 100 : 0,
  });

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

  const topFollowedRules = Object.entries(ruleCount)
    .filter(([_, counts]) => counts.followed > 0)
    .sort((a, b) => b[1].followed - a[1].followed)
    .slice(0, 10)
    .map(([rule, counts]) => ({ rule, followedCount: counts.followed }));

  const topUnfollowedRules = Object.entries(ruleCount)
    .filter(([_, counts]) => counts.unfollowed > 0)
    .sort((a, b) => b[1].unfollowed - a[1].unfollowed)
    .slice(0, 10)
    .map(([rule, counts]) => ({ rule, unfollowedCount: counts.unfollowed }));

  return {
    profit_days: calculateAverages(profitDays),
    loss_days: calculateAverages(lossDays),
    breakEven_days: calculateAverages(breakEvenDays),
    topFollowedRules,
    topUnfollowedRules,
  };
}
exports.calculateDateRangeMetrics = calculateDateRangeMetrics;
// API endpoint handler
exports.getDateRangeMetrics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const metrics = await calculateDateRangeMetrics(
      req.user._id,
      startDate,
      endDate
    );
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


exports.getWeeklyData = async (req, res) => {
  try {
    const { date } = req.query;
    const startOfWeek = moment(date).startOf("isoWeek");
    const endOfWeek = moment(date).endOf("isoWeek");

    const journals = await Journal.find({
      user: req.user._id,
      date: { $gte: startOfWeek, $lte: endOfWeek },
    });

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startOfWeek, $lte: endOfWeek },
    });

    const weekData = {};
    for (let i = 0; i < 7; i++) {
      const currentDate = moment(startOfWeek).add(i, "days");
      const dateStr = currentDate.format("YYYY-MM-DD");
      const dayJournals = journals.filter((j) =>
        moment(j.date).isSame(currentDate, "day")
      );
      const dayTrades = trades.filter((t) =>
        moment(t.date).isSame(currentDate, "day")
      );

      weekData[dateStr] = {
        tradesTaken: dayTrades.length,
        rulesFollowed: dayJournals.reduce(
          (sum, j) => sum + j.rulesFollowed.length,
          0
        ),
        rulesUnfollowed: dayJournals.reduce(
          (sum, j) => sum + j.rulesUnfollowed.length,
          0
        ),
        totalProfitLoss: dayTrades.reduce((sum, t) => sum + t.profitOrLoss, 0),
        winTrades: dayTrades.filter((t) => t.profitOrLoss > 0).length,
        lossTrades: dayTrades.filter((t) => t.profitOrLoss < 0).length,
      };
    }

    res.json(weekData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMonthlyProfitLossDates = async (req, res) => {
  try {
    const { year, month } = req.query;
    const startOfMonth = moment(`${year}-${month}-01`).startOf("month");
    const endOfMonth = moment(startOfMonth).endOf("month");

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    const profitLossDates = {};
    trades.forEach((trade) => {
      const dateStr = moment(trade.date).format("YYYY-MM-DD");
      profitLossDates[dateStr] =
        (profitLossDates[dateStr] || 0) + trade.profitOrLoss;
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

