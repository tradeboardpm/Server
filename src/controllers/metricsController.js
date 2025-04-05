const Journal = require("../models/Journal");
const Trade = require("../models/Trade");
const Rule = require("../models/Rule");
const RuleState = require("../models/RuleState");

// Helper function to pad numbers (e.g., 3 → "03")
const padNumber = (num) => String(num).padStart(2, "0");

// Helper function to create UTC date at midnight
const createUTCDate = (year, month, day = 1) => {
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (isNaN(date.getTime())) {
    throw new Error("Invalid date parameters");
  }
  return date;
};

// Helper function to format date as YYYY-MM-DD
const formatDate = (date) => {
  return `${date.getUTCFullYear()}-${padNumber(date.getUTCMonth() + 1)}-${padNumber(date.getUTCDate())}`;
};

// Helper function to get start and end of day/week/month
const getDayRange = (date) => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
};

const getWeekRange = (date) => {
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // Sunday
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6); // Saturday
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
};

const getMonthRange = (year, month) => {
  const start = createUTCDate(year, month);
  const end = new Date(Date.UTC(year, month - 1, 1));
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0); // Last day of the month
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
};

exports.getDateRangeMetrics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(23, 59, 59, 999);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error("Invalid date format. Use YYYY-MM-DD.");
    }

    const journals = await Journal.find({
      user: req.user._id,
      date: { $gte: start, $lte: end },
    });

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: start, $lte: end },
    });

    const rules = await Rule.find({ user: req.user._id });

    const ruleStates = await RuleState.find({
      user: req.user._id,
      date: { $gte: start, $lte: end },
    }).populate("rule");

    if (journals.length === 0 && trades.length === 0 && ruleStates.length === 0) {
      return res.json({});
    }

    const profitDays = { count: 0, rulesFollowed: 0, totalRules: 0, wordsJournaled: 0, tradesTaken: 0, winTrades: 0 };
    const lossDays = { count: 0, rulesFollowed: 0, totalRules: 0, wordsJournaled: 0, tradesTaken: 0, winTrades: 0 };
    const breakEvenDays = { count: 0, rulesFollowed: 0, totalRules: 0, wordsJournaled: 0, tradesTaken: 0, winTrades: 0 };

    const dailyMetrics = {};
    const daysWithActivity = new Set();

    journals.forEach((journal) => {
      const dateStr = formatDate(new Date(journal.date));
      daysWithActivity.add(dateStr);
      dailyMetrics[dateStr] = {
        rulesFollowed: 0,
        wordsJournaled: (journal.note + " " + journal.mistake + " " + journal.lesson).split(/\s+/).length,
        tradesTaken: 0,
        profitOrLoss: 0,
        winTrades: 0,
      };
    });

    trades.forEach((trade) => {
      const dateStr = formatDate(new Date(trade.date));
      daysWithActivity.add(dateStr);
      if (!dailyMetrics[dateStr]) {
        dailyMetrics[dateStr] = { rulesFollowed: 0, wordsJournaled: 0, tradesTaken: 0, profitOrLoss: 0, winTrades: 0 };
      }
      dailyMetrics[dateStr].tradesTaken++;
      const tradePnL = (trade.sellingPrice - trade.buyingPrice) * trade.quantity - (trade.exchangeRate + trade.brokerage);
      dailyMetrics[dateStr].profitOrLoss += tradePnL;
      if (tradePnL > 0) dailyMetrics[dateStr].winTrades++;
    });

    // Calculate rules followed per day
    ruleStates.forEach((rs) => {
      const dateStr = formatDate(new Date(rs.date));
      if (dailyMetrics[dateStr] && rs.isActive && rs.isFollowed) {
        dailyMetrics[dateStr].rulesFollowed++;
      }
    });

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

      // Get active rules for this date
      const activeRules = ruleStates.filter(rs => 
        rs.date.getTime() === new Date(dateStr).getTime() && rs.isActive
      ).length || rules.length; // Fallback to total rules if no states
      category.totalRules += activeRules;

      category.wordsJournaled += metric.wordsJournaled;
      category.tradesTaken += metric.tradesTaken;
      category.winTrades += metric.winTrades;
    });

    const calculateAverages = (data) => ({
      avgRulesFollowed: data.totalRules > 0 ? Number(((data.rulesFollowed / data.totalRules) * 100).toFixed(2)) : 0,
      avgWordsJournaled: data.count > 0 ? Number((data.wordsJournaled / data.count).toFixed(2)) : 0,
      avgTradesTaken: data.count > 0 ? Number((data.tradesTaken / data.count).toFixed(2)) : 0,
      winRate: data.tradesTaken > 0 ? Number(((data.winTrades / data.tradesTaken) * 100).toFixed(2)) : 0,
    });

    const ruleFollowedCount = {};
    const ruleUnfollowedCount = {};
    ruleStates.forEach((rs) => {
      if (rs.rule) { // Ensure rule is populated
        if (rs.isActive && rs.isFollowed) {
          ruleFollowedCount[rs.rule.description] = (ruleFollowedCount[rs.rule.description] || 0) + 1;
        } else if (rs.isActive && !rs.isFollowed) {
          ruleUnfollowedCount[rs.rule.description] = (ruleUnfollowedCount[rs.rule.description] || 0) + 1;
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
    const givenDate = new Date(date);
    if (isNaN(givenDate.getTime())) {
      throw new Error("Invalid date format. Use YYYY-MM-DD.");
    }

    const { start: startOfWeek, end: endOfWeek } = getWeekRange(givenDate);

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startOfWeek, $lte: endOfWeek },
    });

    const rules = await Rule.find({ user: req.user._id });

    const ruleStates = await RuleState.find({
      user: req.user._id,
      date: { $gte: startOfWeek, $lte: endOfWeek },
    }).populate("rule");

    const journals = await Journal.find({
      user: req.user._id,
      date: { $gte: startOfWeek, $lte: endOfWeek },
    });

    const weeklyData = {};
    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(startOfWeek);
      currentDate.setUTCDate(currentDate.getUTCDate() + i);
      const dateStr = formatDate(currentDate);
      weeklyData[dateStr] = {
        tradesTaken: 0,
        closedTrades: 0,
        rulesFollowed: 0,
        rulesUnfollowed: 0,
        totalRules: 0,
        totalProfitLoss: 0,
        winTrades: 0,
        lossTrades: 0,
        winRate: 0,
        hasInteraction: false,
      };
    }

    trades.forEach((trade) => {
      const dateStr = formatDate(new Date(trade.date));
      weeklyData[dateStr].tradesTaken++;
      weeklyData[dateStr].hasInteraction = true;
      if (!trade.isOpen) {
        weeklyData[dateStr].closedTrades++;
        const tradePnL = (trade.sellingPrice - trade.buyingPrice) * trade.quantity - (trade.exchangeRate + trade.brokerage);
        weeklyData[dateStr].totalProfitLoss += tradePnL;
        if (tradePnL > 0) {
          weeklyData[dateStr].winTrades++;
        } else if (tradePnL < 0) {
          weeklyData[dateStr].lossTrades++;
        }
      }
    });

    ruleStates.forEach((rs) => {
      const dateStr = formatDate(new Date(rs.date));
      if (weeklyData[dateStr] && rs.rule) {
        weeklyData[dateStr].hasInteraction = true;
        if (rs.isActive) {
          if (rs.isFollowed) {
            weeklyData[dateStr].rulesFollowed++;
          } else {
            weeklyData[dateStr].rulesUnfollowed++;
          }
        }
      }
    });

    journals.forEach((journal) => {
      const dateStr = formatDate(new Date(journal.date));
      if (weeklyData[dateStr]) {
        weeklyData[dateStr].hasInteraction = true;
      }
    });

    Object.keys(weeklyData).forEach((dateStr) => {
      const dayData = weeklyData[dateStr];
      if (dayData.hasInteraction) {
        // Get active rules for this date
        const activeRules = ruleStates.filter(rs => 
          rs.date.getTime() === new Date(dateStr).getTime() && rs.isActive
        ).length;
        dayData.totalRules = activeRules || rules.length; // Fallback to total rules if no states

        if (dayData.rulesFollowed + dayData.rulesUnfollowed === 0) {
          dayData.rulesUnfollowed = dayData.totalRules;
        }
      } else {
        dayData.totalRules = rules.length; // Default to all rules if no interaction
        dayData.rulesFollowed = 0;
        dayData.rulesUnfollowed = 0;
      }
      dayData.winRate = dayData.closedTrades > 0 ? Number(((dayData.winTrades / dayData.closedTrades) * 100).toFixed(2)) : 0;
    });

    res.json(weeklyData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMonthlyProfitLossDates = async (req, res) => {
  try {
    const { year, month } = req.query;
    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10);
    if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      throw new Error("Invalid year or month. Use YYYY and MM (1-12).");
    }

    const { start: startOfMonth, end: endOfMonth } = getMonthRange(yearNum, monthNum);

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    const journals = await Journal.find({
      user: req.user._id,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    const ruleStates = await RuleState.find({
      user: req.user._id,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    const profitLossDates = {};
    const daysWithActivity = new Set();

    // Process trades
    trades.forEach((trade) => {
      const dateStr = formatDate(new Date(trade.date));
      daysWithActivity.add(dateStr);
      if (trade.action === "both" && trade.sellingPrice && trade.buyingPrice) {
        const tradePnL =
          (trade.sellingPrice - trade.buyingPrice) * trade.quantity -
          (trade.exchangeRate + trade.brokerage);
        profitLossDates[dateStr] = (profitLossDates[dateStr] || 0) + tradePnL;
      }
    });

    // Process journals - include days with only images
    journals.forEach((journal) => {
      const dateStr = formatDate(new Date(journal.date));
      const noteContent = journal.note || "";
      const mistakeContent = journal.mistake || "";
      const lessonContent = journal.lesson || "";
      const hasContent = noteContent.trim() || mistakeContent.trim() || lessonContent.trim();
      const hasImages = journal.attachedFiles && journal.attachedFiles.length > 0;

      // Add to daysWithActivity if there's either content or images
      if (hasContent || hasImages) {
        daysWithActivity.add(dateStr);
      }
    });

    // Process rule states
    ruleStates.forEach((rs) => {
      if (rs.isActive && rs.isFollowed) {
        const dateStr = formatDate(new Date(rs.date));
        daysWithActivity.add(dateStr);
      }
    });

    // Process all dates in the month
    const currentDate = new Date(startOfMonth);
    while (currentDate <= endOfMonth) {
      const dateStr = formatDate(currentDate);
      if (dateStr in profitLossDates) {
        const dailyProfitLoss = profitLossDates[dateStr];
        if (dailyProfitLoss > 100) {
          profitLossDates[dateStr] = "profit";
        } else if (dailyProfitLoss < -100) {
          profitLossDates[dateStr] = "loss";
        } else {
          profitLossDates[dateStr] = "breakeven";
        }
      } else if (daysWithActivity.has(dateStr)) {
        profitLossDates[dateStr] = "breakeven"; // Includes days with only images
      }
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    res.json(profitLossDates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getJournalDates = async (req, res) => {
  try {
    const journals = await Journal.find({ user: req.user._id }).select("date").lean();
    const trades = await Trade.find({ user: req.user._id }).select("date").lean();
    const ruleStates = await RuleState.find({ 
      user: req.user._id, 
      isFollowed: true,
      isActive: true 
    }).select("date").lean();

    const uniqueDates = new Set();
    journals.forEach((journal) => uniqueDates.add(formatDate(new Date(journal.date))));
    trades.forEach((trade) => uniqueDates.add(formatDate(new Date(trade.date))));
    ruleStates.forEach((rule) => uniqueDates.add(formatDate(new Date(rule.date))));

    const dates = Array.from(uniqueDates).sort();

    res.json({ dates });
  } catch (error) {
    console.error("Error in getJournalDates:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = exports;