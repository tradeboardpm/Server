// controllers/journalController.js
const mongoose = require("mongoose");
const Journal = require("../models/Journal");
const RuleState = require("../models/RuleState");
const User = require("../models/User");
const Rule = require("../models/Rule");
const Trade = require("../models/Trade");
const moment = require("moment");
const { s3Client } = require("../config/s3");
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { updateUserPointsForToday } = require("../utils/pointsHelper");
const { getEffectiveRulesForDate } = require("../utils/ruleHelper");

// =============================
// CREATE OR UPDATE JOURNAL
// =============================
exports.createOrUpdateJournal = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const inputDate = moment.utc(req.body.date).startOf("day");
    let journal = await Journal.findOne({ user: req.user._id, date: inputDate }).session(session);

    if (!journal) {
      journal = new Journal({ user: req.user._id, date: inputDate });
    }

    // Update text fields only if provided
    journal.note = req.body.note !== undefined ? req.body.note : journal.note || "";
    journal.mistake = req.body.mistake !== undefined ? req.body.mistake : journal.mistake || "";
    journal.lesson = req.body.lesson !== undefined ? req.body.lesson : journal.lesson || "";
    journal.tags = req.body.tags !== undefined ? req.body.tags : journal.tags || [];

    // Handle file uploads (max 3)
    if (req.files && req.files.length > 0) {
      if (journal.attachedFiles.length + req.files.length > 3) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).send({ error: "Maximum of 3 files allowed per journal" });
      }
      const encodedFiles = req.files.map((file) => encodeURI(file.location));
      journal.attachedFiles = journal.attachedFiles.concat(encodedFiles);
    }

    // Determine if journal is effectively empty
    const isEmpty =
      (!journal.note || journal.note.trim() === "") &&
      (!journal.mistake || journal.mistake.trim() === "") &&
      (!journal.lesson || journal.lesson.trim() === "") &&
      journal.tags.length === 0 &&
      journal.attachedFiles.length === 0;

    if (isEmpty && journal._id) {
      // Delete empty existing journal
      await Journal.findByIdAndDelete(journal._id).session(session);
      const pointsChange = await updateUserPointsForToday(req.user._id, session);
      await session.commitTransaction();
      session.endSession();
      return res.status(200).send({ message: "Empty journal entry deleted", pointsChange });
    }

    if (isEmpty && !journal._id) {
      // Nothing to create
      await session.commitTransaction();
      session.endSession();
      return res.status(200).send({ message: "No journal entry created" });
    }

    // Save non-empty journal
    await journal.save({ session });
    const pointsChange = await updateUserPointsForToday(req.user._id, session);
    await session.commitTransaction();
    session.endSession();

    return res.status(200).send({ journal, pointsChange });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error in createOrUpdateJournal:", error);
    res.status(400).send({ error: error.message });
  }
};

// =============================
// GET JOURNAL BY DATE
// =============================
exports.getJournal = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = moment.utc(date).startOf("day").toDate();

    const journal = await Journal.findOne({
      user: req.user._id,
      date: targetDate,
    });

    if (!journal) {
      return res.status(200).json({
        note: "",
        mistake: "",
        lesson: "",
        tags: [],
        attachedFiles: [],
      });
    }

    res.status(200).json(journal);
  } catch (error) {
    console.error("Error in getJournal:", error);
    res.status(500).json({ error: error.message });
  }
};

// =============================
// DELETE JOURNAL (by date)
// =============================
exports.deleteJournal = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { date } = req.params;
    const targetDate = moment.utc(date).startOf("day").toDate();

    // 1. Delete journal + S3 files
    const journal = await Journal.findOne({
      user: req.user._id,
      date: targetDate,
    }).session(session);

    let journalDeleted = false;
    if (journal) {
      for (const fileUrl of journal.attachedFiles) {
        const key = fileUrl.split("/").pop();
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: key,
          })
        );
      }
      await journal.deleteOne({ session });
      journalDeleted = true;
    }

    // 2. Delete related rule states
    const deletedRules = await RuleState.deleteMany({
      user: req.user._id,
      date: targetDate,
    }).session(session);

    // 3. Delete trades + adjust capital
    const trades = await Trade.find({
      user: req.user._id,
      date: targetDate,
    }).session(session);

    let capitalChange = 0;
    for (const trade of trades) {
      if (trade.action === "both") capitalChange -= trade.netPnl;
      await Trade.deleteOne({ _id: trade._id }).session(session);
    }

    if (capitalChange !== 0) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(capitalChange, targetDate);
    }

    // 4. Reconcile points for today
    const pointsChange = await updateUserPointsForToday(req.user._id, session);

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      message: "Journal (if exists), trades, and rules deleted successfully",
      journalDeleted,
      capitalChange,
      tradesDeleted: trades.length,
      rulesDeleted: deletedRules.deletedCount,
      pointsChange,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error in deleteJournal:", error);
    res.status(500).json({ error: error.message });
  }
};

// =============================
// GET MONTHLY JOURNALS (for calendar) – FIXED
// =============================
exports.getMonthlyJournals = async (req, res) => {
  try {
    const { year, month } = req.query;

    // 1. Define the month range
    const start = moment.utc(`${year}-${month}-01`).startOf("month");
    const end = start.clone().endOf("month");

    // 2. Fetch everything we need in parallel
    const [journals, trades, ruleStates] = await Promise.all([
      Journal.find({
        user: req.user._id,
        date: { $gte: start.toDate(), $lte: end.toDate() },
      }).lean(),

      Trade.find({
        user: req.user._id,
        date: { $gte: start.toDate(), $lte: end.toDate() },
      }).lean(),

      RuleState.find({
        user: req.user._id,
        date: { $gte: start.toDate(), $lte: end.toDate() },
      })
        .populate("rule")
        .lean(),
    ]);

    // 3. Helper: build a map of day → data
    const daily = {};

    // initialise every day of the month
    let cur = start.clone();
    while (cur.isSameOrBefore(end)) {
      const key = cur.format("YYYY-MM-DD");
      daily[key] = {
        note: "",
        mistake: "",
        lesson: "",
        tags: [],
        attachedFiles: [],
        rulesFollowedPercentage: 0,
        winRate: 0,
        profit: 0,
        tradesTaken: 0,
        hasMeaningfulData: false,
      };
      cur.add(1, "day");
    }

    // ----- Journals -----
    journals.forEach((j) => {
      const key = moment.utc(j.date).format("YYYY-MM-DD");
      const hasContent =
        (j.note?.trim()) ||
        (j.mistake?.trim()) ||
        (j.lesson?.trim()) ||
        (j.tags?.length > 0) ||
        (j.attachedFiles?.length > 0);

      daily[key] = {
        ...daily[key],
        note: j.note || "",
        mistake: j.mistake || "",
        lesson: j.lesson || "",
        tags: j.tags || [],
        attachedFiles: j.attachedFiles || [],
        hasMeaningfulData: hasContent || daily[key].hasMeaningfulData,
      };
    });

    // ----- Trades -----
    trades.forEach((t) => {
      const key = moment.utc(t.date).format("YYYY-MM-DD");
      const dayTrades = trades.filter((tr) =>
        moment.utc(tr.date).isSame(t.date, "day")
      );

      const completed = dayTrades.filter((tr) => tr.action === "both");
      const allOpen = dayTrades.every((tr) => tr.isOpen);

      let profit = 0;
      let winRate = 0;

      if (!allOpen && completed.length) {
        const winners = completed.filter((tr) => tr.netPnl > 0);
        winRate = (winners.length / completed.length) * 100 || 0;
        profit = completed.reduce((s, tr) => s + tr.netPnl, 0);
      }

      daily[key] = {
        ...daily[key],
        winRate: Number(winRate.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        tradesTaken: dayTrades.length,
        hasMeaningfulData: dayTrades.length > 0 || daily[key].hasMeaningfulData,
      };
    });

    // ----- RuleStates -----
    ruleStates.forEach((rs) => {
      const key = moment.utc(rs.date).format("YYYY-MM-DD");
      const dayStates = ruleStates.filter((r) =>
        moment.utc(r.date).isSame(rs.date, "day")
      );

      const active = dayStates.filter((r) => r.isActive).length;
      const followed = dayStates.filter((r) => r.isActive && r.isFollowed).length;
      const percentage = active ? (followed / active) * 100 : 0;

      daily[key] = {
        ...daily[key],
        rulesFollowedPercentage: Number(percentage.toFixed(2)),
        hasMeaningfulData: followed > 0 || daily[key].hasMeaningfulData,
      };
    });

    // 4. Return only days that have *any* meaningful data
    const result = Object.fromEntries(
      Object.entries(daily).filter(([, v]) => v.hasMeaningfulData)
    );

    res.status(200).json(result);
  } catch (error) {
    console.error("Error in getMonthlyJournals:", error);
    res.status(500).json({ error: error.message });
  }
};

// =============================
// GET FILTERED JOURNALS (with win rate, rules, etc.)
// =============================
exports.getFiltersJournals = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      minWinRate,
      maxWinRate,
      minTrades,
      maxTrades,
      minRulesFollowed,
      maxRulesFollowed,
      page = 1,
      limit = 10,
    } = req.query;

    const start = moment.utc(startDate || "2000-01-01").startOf("day");
    const end = moment.utc(endDate || new Date()).endOf("day");

    const filters = {
      minWinRate: minWinRate ? Number.parseFloat(minWinRate) : 0,
      maxWinRate: maxWinRate ? Number.parseFloat(maxWinRate) : 100,
      minTrades: minTrades ? Number.parseInt(minTrades) : 0,
      maxTrades: maxTrades ? Number.parseInt(maxTrades) : Infinity,
      minRulesFollowed: minRulesFollowed ? Number.parseFloat(minRulesFollowed) : 0,
      maxRulesFollowed: maxRulesFollowed ? Number.parseFloat(maxRulesFollowed) : 100,
    };

    if (
      filters.minWinRate > filters.maxWinRate ||
      filters.minTrades > filters.maxTrades ||
      filters.minRulesFollowed > filters.maxRulesFollowed
    ) {
      return res.status(400).json({ error: "Invalid filter ranges" });
    }

    const [journals, trades, ruleStates] = await Promise.all([
      Journal.find({
        user: req.user._id,
        date: { $gte: start.toDate(), $lte: end.toDate() },
      }).sort({ date: 1 }),
      Trade.find({
        user: req.user._id,
        date: { $gte: start.toDate(), $lte: end.toDate() },
      }),
      RuleState.find({
        user: req.user._id,
        date: { $gte: start.toDate(), $lte: end.toDate() },
      }).populate("rule"),
    ]);

    const dailyData = {};
    let currentDate = moment.utc(start);
    while (currentDate.isSameOrBefore(end)) {
      const dateStr = currentDate.format("YYYY-MM-DD");
      dailyData[dateStr] = {
        date: currentDate.toDate(),
        note: "",
        mistake: "",
        lesson: "",
        tags: [],
        rulesFollowedPercentage: 0,
        winRate: 0,
        profit: 0,
        tradesTaken: 0,
        hasMeaningfulData: false,
        attachedFiles: [],
      };
      currentDate.add(1, "day");
    }

    // Process journals
    journals.forEach((journal) => {
      const dateStr = moment.utc(journal.date).format("YYYY-MM-DD");
      const hasJournalContent =
        (journal.note && journal.note.trim()) ||
        (journal.mistake && journal.mistake.trim()) ||
        (journal.lesson && journal.lesson.trim()) ||
        (journal.tags && journal.tags.length > 0) ||
        (journal.attachedFiles && journal.attachedFiles.length > 0);

      dailyData[dateStr] = {
        ...dailyData[dateStr],
        note: journal.note || "",
        mistake: journal.mistake || "",
        lesson: journal.lesson || "",
        tags: journal.tags || [],
        attachedFiles: journal.attachedFiles || [],
        hasMeaningfulData: hasJournalContent || dailyData[dateStr].hasMeaningfulData,
      };
    });

    // Process trades
    trades.forEach((trade) => {
      const dateStr = moment.utc(trade.date).format("YYYY-MM-DD");
      const dayTrades = trades.filter((t) =>
        moment.utc(t.date).isSame(trade.date, "day")
      );

      const completedTrades = dayTrades.filter((t) => t.action === "both");
      const allOpen = dayTrades.every((t) => t.isOpen);

      let profit = 0;
      let winRate = 0;

      if (!allOpen && completedTrades.length > 0) {
        const winningTrades = completedTrades.filter((t) => t.netPnl > 0);
        winRate = (winningTrades.length / completedTrades.length) * 100 || 0;
        profit = completedTrades.reduce((sum, t) => sum + t.netPnl, 0);
      }

      dailyData[dateStr] = {
        ...dailyData[dateStr],
        winRate: Number(winRate.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        tradesTaken: dayTrades.length,
        hasMeaningfulData: dayTrades.length > 0 || dailyData[dateStr].hasMeaningfulData,
      };
    });

    // Process rule states
    ruleStates.forEach((ruleState) => {
      const dateStr = moment.utc(ruleState.date).format("YYYY-MM-DD");
      const dayRuleStates = ruleStates.filter((rs) =>
        moment.utc(rs.date).isSame(ruleState.date, "day")
      );

      const activeRules = dayRuleStates.filter((rs) => rs.isActive).length;
      const rulesFollowedCount = dayRuleStates.filter(
        (rs) => rs.isActive && rs.isFollowed
      ).length;

      const rulesFollowedPercentage = activeRules > 0
        ? (rulesFollowedCount / activeRules) * 100
        : 0;

      dailyData[dateStr] = {
        ...dailyData[dateStr],
        rulesFollowedPercentage: Number(rulesFollowedPercentage.toFixed(2)),
        hasMeaningfulData:
          rulesFollowedCount > 0 || dailyData[dateStr].hasMeaningfulData,
      };
    });

    const filteredData = Object.entries(dailyData)
      .filter(([_, data]) => data.hasMeaningfulData)
      .filter(
        ([_, data]) =>
          data.winRate >= filters.minWinRate &&
          data.winRate <= filters.maxWinRate &&
          data.tradesTaken >= filters.minTrades &&
          data.tradesTaken <= filters.maxTrades &&
          data.rulesFollowedPercentage >= filters.minRulesFollowed &&
          data.rulesFollowedPercentage <= filters.maxRulesFollowed
      )
      .reduce((obj, [date, data]) => {
        obj[date] = data;
        return obj;
      }, {});

    const totalItems = Object.keys(filteredData).length;
    const totalPages = Math.ceil(totalItems / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const paginatedData = Object.fromEntries(
      Object.entries(filteredData)
        .sort(([dateA], [dateB]) => new Date(dateB) - new Date(dateA))
        .slice(startIndex, endIndex)
    );

    res.json({
      data: paginatedData,
      pagination: {
        currentPage: Number.parseInt(page),
        totalPages,
        totalItems,
        limit: Number.parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error in getFiltersJournals:", error);
    res.status(500).json({ error: error.message });
  }
};

// =============================
// GET FULL JOURNAL + TRADES + RULES + SUMMARY FOR A DATE (SAFE)
// =============================
exports.getJournalDetails = async (req, res) => {
  try {
    const { date } = req.query;

    // 1. Validate date parameter
    if (!date) {
      return res.status(400).json({ error: "Missing 'date' query parameter" });
    }

    const momentDate = moment.utc(date);
    if (!momentDate.isValid()) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
    }

    const targetDate = momentDate.startOf("day").toDate();

    // 2. Fetch data
    const [journal, trades, ruleStates] = await Promise.all([
      Journal.findOne({ user: req.user._id, date: targetDate }).lean(),
      Trade.find({ user: req.user._id, date: targetDate }).sort({ time: 1 }).lean(),
      RuleState.find({ user: req.user._id, date: targetDate })
        .populate("rule")
        .lean(),
    ]);

    // 3. Build rules
    const rules = ruleStates
      .filter((rs) => rs.isActive)
      .map((rs) => ({
        _id: rs.rule._id.toString(),
        description: rs.rule.description,
        isFollowed: rs.isFollowed,
        createdAt: rs.createdAt ? rs.createdAt.toISOString() : null,
      }));

    // 4. Build trades summary
    const completedTrades = trades.filter((t) => t.action === "both");
    const totalTrades = trades.length;
    const totalPnL = completedTrades.reduce((sum, t) => sum + (t.netPnl || 0), 0);
    const totalCharges = completedTrades.reduce((sum, t) => sum + (t.brokerage || 0), 0);
    const netPnL = totalPnL - totalCharges;

    const summary = {
      totalTrades,
      totalPnL: Number(totalPnL.toFixed(2)),
      totalCharges: Number(totalCharges.toFixed(2)),
      netPnL: Number(netPnL.toFixed(2)),
    };

    // 5. Final response
    const journalDetails = {
      date: targetDate.toISOString(),
      note: journal?.note || "",
      mistake: journal?.mistake || "",
      lesson: journal?.lesson || "",
      tags: journal?.tags || [],
      attachedFiles: journal?.attachedFiles || [],
      rules,
      trades: trades.map((t) => ({
        ...t,
        _id: t._id.toString(),
        date: t.date.toISOString(),
      })),
    };

    res.status(200).json({
      journalDetails,
      summary,
    });
  } catch (error) {
    console.error("Error in getJournalDetails:", error);
    res.status(500).json({ error: error.message });
  }
};

// =============================
// DELETE SINGLE FILE FROM JOURNAL
// =============================
exports.deleteFile = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { journalId, fileKey } = req.params;

    const journal = await Journal.findOne({ _id: journalId, user: req.user._id }).session(session);
    if (!journal) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "Journal not found" });
    }

    const fileUrl = journal.attachedFiles.find(f => f.includes(fileKey));
    if (!fileUrl) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "File not found" });
    }

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: fileKey,
      })
    );

    journal.removeFile(fileKey);
    await journal.save({ session });

    const pointsChange = await updateUserPointsForToday(req.user._id, session);

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      message: "File deleted successfully",
      pointsChange,
      attachedFiles: journal.attachedFiles,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error in deleteFile:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = exports;