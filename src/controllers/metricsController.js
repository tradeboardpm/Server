// controllers/metricsController.js
const mongoose = require("mongoose");
const Journal = require("../models/Journal");
const Trade = require("../models/Trade");
const RuleState = require("../models/RuleState");
const { getEffectiveRulesForDate } = require("../utils/ruleHelper");
const moment = require("moment");
const { normalizeDate, formatDate } = require("../utils/dateHelper");

// Helper: pad number (01, 02, etc.)
const padNumber = (num) => String(num).padStart(2, "0");

// Week range (Sunday to Saturday in UTC)
const getWeekRange = (date) => {
  const start = moment.utc(date).startOf("week").toDate(); // Sunday
  const end = moment.utc(start).add(6, "days").endOf("day").toDate();
  return { start, end };
};

// Month range (UTC)
const getMonthRange = (year, month) => {
  const start = moment
    .utc(`${year}-${padNumber(month)}-01`)
    .startOf("month")
    .toDate();
  const end = moment.utc(start).endOf("month").toDate();
  return { start, end };
};

// GET DATE RANGE METRICS – FIXED VERSION
exports.getDateRangeMetrics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = normalizeDate(startDate);
    const end = normalizeDate(endDate);

    const [journals, trades, ruleStates] = await Promise.all([
      Journal.find({ user: req.user._id, date: { $gte: start, $lte: end } }).lean(),
      Trade.find({ user: req.user._id, date: { $gte: start, $lte: end } }).lean(),
      RuleState.find({
        user: req.user._id,
        date: { $gte: start, $lte: end },
        isActive: true,               // ← important
      })
        .populate("rule", "description")
        .lean(),
    ]);

    const profitDays = { count: 0, rulesFollowed: 0, totalRules: 0, wordsJournaled: 0, tradesTaken: 0, winTrades: 0 };
    const lossDays   = { count: 0, rulesFollowed: 0, totalRules: 0, wordsJournaled: 0, tradesTaken: 0, winTrades: 0 };
    const breakEvenDays = { count: 0, rulesFollowed: 0, totalRules: 0, wordsJournaled: 0, tradesTaken: 0, winTrades: 0 };

    const dailyMetrics = {};

    // ---------- Journals ----------
    journals.forEach((j) => {
      const dateStr = formatDate(j.date);
      if (!dailyMetrics[dateStr])
        dailyMetrics[dateStr] = { rulesFollowed: 0, wordsJournaled: 0, tradesTaken: 0, profitOrLoss: 0, winTrades: 0 };
      const words = (j.note + " " + j.mistake + " " + j.lesson)
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      dailyMetrics[dateStr].wordsJournaled += words;
    });

    // ---------- Trades ----------
    trades.forEach((t) => {
      const dateStr = formatDate(t.date);
      if (!dailyMetrics[dateStr])
        dailyMetrics[dateStr] = { rulesFollowed: 0, wordsJournaled: 0, tradesTaken: 0, profitOrLoss: 0, winTrades: 0 };
      dailyMetrics[dateStr].tradesTaken++;
      if (t.action === "both" && t.sellingPrice && t.buyingPrice) {
        const pnl =
          (t.sellingPrice - t.buyingPrice) * t.quantity -
          (t.exchangeRate || 0) -
          (t.brokerage || 0);
        dailyMetrics[dateStr].profitOrLoss += pnl;
        if (pnl > 0) dailyMetrics[dateStr].winTrades++;
      }
    });

    // ---------- Rule states (per-day) ----------
    ruleStates.forEach((rs) => {
      const dateStr = formatDate(rs.date);
      const day = dailyMetrics[dateStr];
      if (day && rs.isFollowed) {
        day.rulesFollowed++;
      }
    });

    // ---------- Categorise days ----------
    Object.entries(dailyMetrics).forEach(([dateStr, m]) => {
      let category;
      if (m.profitOrLoss > 100) category = profitDays;
      else if (m.profitOrLoss < -100) category = lossDays;
      else category = breakEvenDays;

      category.count++;
      category.rulesFollowed += m.rulesFollowed;
      category.totalRules += ruleStates.filter(
        (rs) => formatDate(rs.date) === dateStr && rs.isActive
      ).length;
      category.wordsJournaled += m.wordsJournaled;
      category.tradesTaken += m.tradesTaken;
      category.winTrades += m.winTrades;
    });

    // ---------- NEW: Count followed / unfollowed ONLY for days that appear in metrics ----------
    const ruleFollowedCount = {};
    const ruleUnfollowedCount = {};

    ruleStates.forEach((rs) => {
      const dateStr = formatDate(rs.date);
      if (dailyMetrics[dateStr] && rs.rule?.description) {   // ← only count days that are part of the report
        if (rs.isFollowed) {
          ruleFollowedCount[rs.rule.description] = (ruleFollowedCount[rs.rule.description] || 0) + 1;
        } else {
          ruleUnfollowedCount[rs.rule.description] = (ruleUnfollowedCount[rs.rule.description] || 0) + 1;
        }
      }
    });

    const topFollowedRules = Object.entries(ruleFollowedCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([rule, count]) => ({ rule, count }));

    const topUnfollowedRules = Object.entries(ruleUnfollowedCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([rule, count]) => ({ rule, count }));

    // ---------- Averages ----------
    const calculateAverages = (data) => ({
      avgRulesFollowed: data.totalRules > 0 ? Number(((data.rulesFollowed / data.totalRules) * 100).toFixed(2)) : 0,
      avgWordsJournaled: data.count > 0 ? Number((data.wordsJournaled / data.count).toFixed(2)) : 0,
      avgTradesTaken: data.count > 0 ? Number((data.tradesTaken / data.count).toFixed(2)) : 0,
      winRate: data.tradesTaken > 0 ? Number(((data.winTrades / data.tradesTaken) * 100).toFixed(2)) : 0,
    });

    res.json({
      profit_days: calculateAverages(profitDays),
      loss_days: calculateAverages(lossDays),
      breakEven_days: calculateAverages(breakEvenDays),
      topFollowedRules,
      topUnfollowedRules,
    });
  } catch (error) {
    console.error("Error in getDateRangeMetrics:", error);
    res.status(500).json({ error: error.message });
  }
};

// GET WEEKLY DATA - FIXED: Removed transaction to avoid conflicts
exports.getWeeklyData = async (req, res) => {
  try {
    const { date } = req.query;
    const givenDate = normalizeDate(date);

    const { start: startOfWeek, end: endOfWeek } = getWeekRange(givenDate);

    const [trades, journals, ruleStates] = await Promise.all([
      Trade.find({ user: req.user._id, date: { $gte: startOfWeek, $lte: endOfWeek } }).lean(),
      Journal.find({ user: req.user._id, date: { $gte: startOfWeek, $lte: endOfWeek } }).lean(),
      RuleState.find({ user: req.user._id, date: { $gte: startOfWeek, $lte: endOfWeek } })
        .populate("rule")
        .lean(),
    ]);

    const weeklyData = {};
    for (let i = 0; i < 7; i++) {
      const currentDate = moment.utc(startOfWeek).add(i, "days").toDate();
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

    trades.forEach((t) => {
      const dateStr = formatDate(t.date);
      const day = weeklyData[dateStr];
      if (day) {
        day.tradesTaken++;
        day.hasInteraction = true;
        if (t.action === "both") {
          day.closedTrades++;
          const pnl =
            (t.sellingPrice - t.buyingPrice) * t.quantity -
            (t.exchangeRate || 0) -
            (t.brokerage || 0);
          day.totalProfitLoss += pnl;
          if (pnl > 0) day.winTrades++;
          else if (pnl < 0) day.lossTrades++;
        }
      }
    });

    journals.forEach((j) => {
      const dateStr = formatDate(j.date);
      if (weeklyData[dateStr]) weeklyData[dateStr].hasInteraction = true;
    });

    for (const dateStr of Object.keys(weeklyData)) {
      const day = weeklyData[dateStr];
      const dateObj = normalizeDate(dateStr);

      const dayRuleStates = ruleStates.filter(
        (rs) => formatDate(rs.date) === dateStr && rs.isActive
      );
      const hasInteraction =
        day.hasInteraction || dayRuleStates.some((rs) => rs.isFollowed);

      if (hasInteraction) {
        // Removed session parameter - getEffectiveRulesForDate runs without transaction
        const effectiveRules = await getEffectiveRulesForDate(req.user._id, dateObj);
        day.totalRules = effectiveRules.length;
        day.rulesFollowed = dayRuleStates.filter((rs) => rs.isFollowed).length;
        day.rulesUnfollowed = day.totalRules - day.rulesFollowed;
      } else {
        day.totalRules = 0;
        day.rulesFollowed = 0;
        day.rulesUnfollowed = 0;
      }

      day.winRate =
        day.closedTrades > 0
          ? Number(((day.winTrades / day.closedTrades) * 100).toFixed(2))
          : 0;
    }

    res.json(weeklyData);
  } catch (error) {
    console.error("Error in getWeeklyData:", error);
    res.status(500).json({ error: error.message });
  }
};

// GET MONTHLY PROFIT/LOSS DATES
exports.getMonthlyProfitLossDates = async (req, res) => {
  try {
    const { year, month } = req.query;
    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10);
    if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ error: "Invalid year or month." });
    }

    const { start: startOfMonth, end: endOfMonth } = getMonthRange(yearNum, monthNum);

    const [trades, journals, ruleStates] = await Promise.all([
      Trade.find({ user: req.user._id, date: { $gte: startOfMonth, $lte: endOfMonth } }).lean(),
      Journal.find({ user: req.user._id, date: { $gte: startOfMonth, $lte: endOfMonth } }).lean(),
      RuleState.find({ user: req.user._id, date: { $gte: startOfMonth, $lte: endOfMonth }, isActive: true }).lean(),
    ]);

    const profitLossDates = {};
    const daysWithActivity = new Set();

    // Trades
    trades.forEach((t) => {
      const dateStr = formatDate(t.date);
      daysWithActivity.add(dateStr);
      if (t.action === "both") {
        const pnl =
          (t.sellingPrice - t.buyingPrice) * t.quantity -
          (t.exchangeRate || 0) -
          (t.brokerage || 0);
        profitLossDates[dateStr] = (profitLossDates[dateStr] || 0) + pnl;
      }
    });

    // Journals
    journals.forEach((j) => {
      const dateStr = formatDate(j.date);
      const hasText = [j.note, j.mistake, j.lesson].some((s) => s?.trim());
      const hasImages = j.attachedFiles?.length > 0;
      if (hasText || hasImages) daysWithActivity.add(dateStr);
    });

    // RuleStates
    ruleStates.forEach((rs) => {
      if (rs.isFollowed) {
        const dateStr = formatDate(rs.date);
        daysWithActivity.add(dateStr);
      }
    });

    // Fill all days in the month
    let current = moment.utc(startOfMonth);
    while (current.isSameOrBefore(endOfMonth, "day")) {
      const dateStr = current.format("YYYY-MM-DD");
      const pnl = profitLossDates[dateStr] || 0;

      if (pnl > 100) {
        profitLossDates[dateStr] = "profit";
      } else if (pnl < -100) {
        profitLossDates[dateStr] = "loss";
      } else if (daysWithActivity.has(dateStr)) {
        profitLossDates[dateStr] = "breakeven";
      }
      // else → undefined (no activity)

      current.add(1, "day");
    }

    res.json(profitLossDates);
  } catch (error) {
    console.error("Error in getMonthlyProfitLossDates:", error);
    res.status(500).json({ error: error.message });
  }
};

// GET JOURNAL DATES
exports.getJournalDates = async (req, res) => {
  try {
    const [journals, trades, ruleStates] = await Promise.all([
      Journal.find({ user: req.user._id }).select("date").lean(),
      Trade.find({ user: req.user._id }).select("date").lean(),
      RuleState.find({ user: req.user._id, isActive: true, isFollowed: true }).select("date").lean(),
    ]);

    const dates = new Set();

    journals.forEach((j) => dates.add(formatDate(j.date)));
    trades.forEach((t) => dates.add(formatDate(t.date)));
    ruleStates.forEach((rs) => {
      const dateStr = formatDate(rs.date);
      dates.add(dateStr);
    });

    res.json({ dates: Array.from(dates).sort() });
  } catch (error) {
    console.error("Error in getJournalDates:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = exports;