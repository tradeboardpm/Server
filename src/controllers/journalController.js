const mongoose = require("mongoose");
const Journal = require("../models/Journal");
const RuleState = require("../models/RuleState");
const User = require("../models/User");
const Rule = require("../models/Rule");
const Trade = require("../models/Trade");
const moment = require("moment");
const { s3Client } = require("../config/s3");
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { updateUserPointsForActionToday } = require("../utils/pointsHelper");

exports.createOrUpdateJournal = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const date = moment.utc(req.body.date).startOf("day");
    let journal = await Journal.findOne({ user: req.user._id, date }).session(session);

    if (!journal) {
      journal = new Journal({ user: req.user._id, date });
    }

    const newFields = {
      note: req.body.note !== undefined ? req.body.note : journal.note || "",
      mistake: req.body.mistake !== undefined ? req.body.mistake : journal.mistake || "",
      lesson: req.body.lesson !== undefined ? req.body.lesson : journal.lesson || "",
    };

    journal.note = newFields.note;
    journal.mistake = newFields.mistake;
    journal.lesson = newFields.lesson;
    journal.tags = req.body.tags !== undefined ? req.body.tags : journal.tags || [];

    if (req.files && req.files.length > 0) {
      if (journal.attachedFiles.length + req.files.length > 3) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).send({ error: "Maximum of 3 files allowed per journal" });
      }
      const encodedFiles = req.files.map((file) => encodeURI(file.location));
      journal.attachedFiles = journal.attachedFiles.concat(encodedFiles);
    }

    const isEmpty =
      (!journal.note || journal.note.trim() === "") &&
      (!journal.mistake || journal.mistake.trim() === "") &&
      (!journal.lesson || journal.lesson.trim() === "") &&
      journal.tags.length === 0 &&
      journal.attachedFiles.length === 0;

    if (isEmpty && journal._id) {
      await Journal.findByIdAndDelete(journal._id).session(session);
      const pointsChange = await updateUserPointsForActionToday(req.user._id, new Date(), session);
      await session.commitTransaction();
      session.endSession();
      return res.status(200).send({ message: "Empty journal entry deleted", pointsChange });
    } else if (isEmpty && !journal._id) {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).send({ message: "No journal entry created" });
    } else {
      await journal.save({ session });
      const pointsChange = await updateUserPointsForActionToday(req.user._id, new Date(), session);
      await session.commitTransaction();
      session.endSession();
      return res.status(200).send({ journal, pointsChange });
    }
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error in createOrUpdateJournal:", error);
    res.status(400).send({ error: error.message });
  }
};

exports.deleteJournal = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { date } = req.params;
    const targetDate = new Date(date);

    const journal = await Journal.findOne({ date: targetDate, user: req.user._id }).session(session);

    if (journal) {
      for (const fileUrl of journal.attachedFiles) {
        const key = fileUrl.split("/").pop();
        await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_S3_BUCKET_NAME, Key: key }));
      }
      await journal.deleteOne({ session });
    }

    const deletedRules = await RuleState.deleteMany({ user: req.user._id, date: targetDate }).session(session);
    const trades = await Trade.find({ user: req.user._id, date: targetDate }).session(session);

    let capitalChange = 0;
    for (const trade of trades) {
      if (trade.action === "both") capitalChange -= trade.netPnl;
      await Trade.deleteOne({ _id: trade._id }).session(session);
    }

    if (capitalChange !== 0) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(capitalChange, targetDate);
    }

    const pointsChange = await updateUserPointsForActionToday(req.user._id, new Date(), session);

    await session.commitTransaction();
    session.endSession();
    res.send({
      message: "Journal (if exists), trades, and rules deleted successfully",
      capitalChange,
      tradesDeleted: trades.length,
      rulesDeleted: deletedRules.deletedCount,
      journalDeleted: journal ? true : false,
      pointsChange,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error in deleteJournal:", error);
    res.status(500).send({ error: error.message });
  }
};


exports.deleteFile = async (req, res) => {
  try {
    const { journalId, fileKey } = req.params;
    const journal = await Journal.findOne({
      _id: journalId,
      user: req.user._id,
    });

    if (!journal) {
      return res.status(404).send({ error: "Journal not found" });
    }

    const decodedFileKey = decodeURI(fileKey);
    const fileIndex = journal.attachedFiles.findIndex((file) =>
      decodeURI(file).endsWith(decodedFileKey)
    );

    if (fileIndex === -1) {
      return res.status(404).send({ error: "File not found in journal" });
    }

    const s3Key = decodeURI(fileKey.split("/").pop());

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: s3Key,
      })
    );

    journal.attachedFiles.splice(fileIndex, 1);
    await journal.save();

    res.send({ message: "File deleted successfully" });
  } catch (error) {
    console.error("Error in deleteFile:", error);
    res.status(500).send({ error: error.message });
  }
};

exports.getJournal = async (req, res) => {
  try {
    const date = moment.utc(req.query.date).startOf("day");
    const journal = await Journal.findOne({ user: req.user._id, date });

    if (!journal) {
      return res.status(404).send({ error: "No journal found for this date" });
    }

    res.status(200).send(journal);
  } catch (error) {
    console.error("Error in getJournal:", error);
    res.status(400).send({ error: error.message });
  }
};

exports.getMonthlyJournals = async (req, res) => {
  try {
    const {
      year,
      month,
      minProfit,
      maxProfit,
      minWinRate,
      maxWinRate,
      minTrades,
      maxTrades,
      minRulesFollowed,
      maxRulesFollowed,
    } = req.query;

    const startDate = moment
      .utc({ year: Number.parseInt(year), month: Number.parseInt(month) - 1 })
      .startOf("month");
    const endDate = moment
      .utc({ year: Number.parseInt(year), month: Number.parseInt(month) - 1 })
      .endOf("month");

    // Fetch all journals, trades, and rule states for the month
    const journals = await Journal.find({
      user: req.user._id,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: 1 });

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startDate, $lte: endDate },
    });

    const ruleStates = await RuleState.find({
      user: req.user._id,
      date: { $gte: startDate, $lte: endDate },
    }).populate("rule");

    // Create a map of all dates in the month
    const allDates = {};
    let currentDate = moment.utc(startDate);
    while (currentDate.isSameOrBefore(endDate)) {
      const dateStr = currentDate.format("YYYY-MM-DD");
      allDates[dateStr] = {
        note: "",
        mistake: "",
        lesson: "",
        tags: [],
        rulesFollowedPercentage: 0,
        winRate: 0,
        profit: 0,
        tradesTaken: 0,
        hasMeaningfulData: false, // Changed from hasData to hasMeaningfulData
      };
      currentDate.add(1, "day");
    }

    // Process journals - only mark as meaningful if content exists
    for (const journal of journals) {
      const dateStr = moment.utc(journal.date).format("YYYY-MM-DD");
      const hasJournalContent = 
        (journal.note && journal.note.trim()) ||
        (journal.mistake && journal.mistake.trim()) ||
        (journal.lesson && journal.lesson.trim()) ||
        (journal.tags && journal.tags.length > 0);

      allDates[dateStr] = {
        note: journal.note || "",
        mistake: journal.mistake || "",
        lesson: journal.lesson || "",
        tags: journal.tags || [],
        rulesFollowedPercentage: allDates[dateStr].rulesFollowedPercentage,
        winRate: allDates[dateStr].winRate,
        profit: allDates[dateStr].profit,
        tradesTaken: allDates[dateStr].tradesTaken,
        hasMeaningfulData: hasJournalContent || allDates[dateStr].hasMeaningfulData,
      };
    }

    // Process trades
    for (const trade of trades) {
      const dateStr = moment.utc(trade.date).format("YYYY-MM-DD");
      const dayTrades = trades.filter((t) =>
        moment.utc(t.date).isSame(trade.date, "day")
      );

      const winningTrades = dayTrades.filter(
        (t) =>
          (t.sellingPrice - t.buyingPrice) * t.quantity -
            (t.exchangeRate + t.brokerage) >
          0
      );
      const winRate = (winningTrades.length / dayTrades.length) * 100 || 0;
      const profit = dayTrades.reduce(
        (sum, t) =>
          sum +
          (t.sellingPrice - t.buyingPrice) * t.quantity -
          (t.exchangeRate + t.brokerage),
        0
      );

      allDates[dateStr] = {
        ...allDates[dateStr],
        winRate: Number(winRate.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        tradesTaken: dayTrades.length,
        hasMeaningfulData: dayTrades.length > 0 || allDates[dateStr].hasMeaningfulData,
      };
    }

    // Process rule states - only mark as meaningful if rules are followed
    for (const ruleState of ruleStates) {
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

      allDates[dateStr] = {
        ...allDates[dateStr],
        rulesFollowedPercentage: Number(rulesFollowedPercentage.toFixed(2)),
        hasMeaningfulData: 
          rulesFollowedCount > 0 || allDates[dateStr].hasMeaningfulData,
      };
    }

    // Filter out dates without meaningful data
    const filteredDates = {};
    for (const dateStr in allDates) {
      if (allDates[dateStr].hasMeaningfulData) {
        const data = allDates[dateStr];

        // Apply additional filters
        if (
          (minProfit && data.profit < Number.parseFloat(minProfit)) ||
          (maxProfit && data.profit > Number.parseFloat(maxProfit)) ||
          (minWinRate && data.winRate < Number.parseFloat(minWinRate)) ||
          (maxWinRate && data.winRate > Number.parseFloat(maxWinRate)) ||
          (minTrades && data.tradesTaken < Number.parseInt(minTrades)) ||
          (maxTrades && data.tradesTaken > Number.parseInt(maxTrades)) ||
          (minRulesFollowed &&
            data.rulesFollowedPercentage < Number.parseFloat(minRulesFollowed)) ||
          (maxRulesFollowed &&
            data.rulesFollowedPercentage > Number.parseFloat(maxRulesFollowed))
        ) {
          continue;
        }

        filteredDates[dateStr] = data;
      }
    }

    res.json(filteredDates);
  } catch (error) {
    console.error("Error in getMonthlyJournals:", error);
    res.status(500).json({ error: error.message });
  }
};

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
      limit = 12,
    } = req.query;

    // Convert and validate date range
    const start = moment.utc(startDate).startOf("day");
    const end = moment.utc(endDate).endOf("day");
    
    if (!start.isValid() || !end.isValid() || start.isAfter(end)) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    // Convert filter values to numbers and set defaults
    const filters = {
      minWinRate: minWinRate ? Number.parseFloat(minWinRate) : 0,
      maxWinRate: maxWinRate ? Number.parseFloat(maxWinRate) : 100,
      minTrades: minTrades ? Number.parseInt(minTrades) : 0,
      maxTrades: maxTrades ? Number.parseInt(maxTrades) : Infinity,
      minRulesFollowed: minRulesFollowed ? Number.parseFloat(minRulesFollowed) : 0,
      maxRulesFollowed: maxRulesFollowed ? Number.parseFloat(maxRulesFollowed) : 100,
    };

    // Validate filter ranges
    if (filters.minWinRate > filters.maxWinRate ||
        filters.minTrades > filters.maxTrades ||
        filters.minRulesFollowed > filters.maxRulesFollowed) {
      return res.status(400).json({ error: "Invalid filter ranges" });
    }

    // Fetch data within date range
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

    // Process data and create daily entries
    const dailyData = {};
    
    // Initialize all dates in range
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
        hasMeaningfulData: false, // Changed from hasData to hasMeaningfulData
      };
      currentDate.add(1, "day");
    }

    // Process journals - only mark as meaningful if content exists
    journals.forEach(journal => {
      const dateStr = moment.utc(journal.date).format("YYYY-MM-DD");
      const hasJournalContent = 
        (journal.note && journal.note.trim()) ||
        (journal.mistake && journal.mistake.trim()) ||
        (journal.lesson && journal.lesson.trim()) ||
        (journal.tags && journal.tags.length > 0);

      dailyData[dateStr] = {
        ...dailyData[dateStr],
        note: journal.note || "",
        mistake: journal.mistake || "",
        lesson: journal.lesson || "",
        tags: journal.tags || [],
        hasMeaningfulData: hasJournalContent || dailyData[dateStr].hasMeaningfulData,
      };
    });

    // Process trades and calculate win rate/profit
    trades.forEach(trade => {
      const dateStr = moment.utc(trade.date).format("YYYY-MM-DD");
      const dayTrades = trades.filter(t => 
        moment.utc(t.date).isSame(trade.date, "day")
      );

      const winningTrades = dayTrades.filter(t => 
        (t.sellingPrice - t.buyingPrice) * t.quantity - 
        (t.exchangeRate + t.brokerage) > 0
      );
      
      const winRate = dayTrades.length > 0 
        ? (winningTrades.length / dayTrades.length) * 100 
        : 0;
      
      const profit = dayTrades.reduce((sum, t) => 
        sum + (t.sellingPrice - t.buyingPrice) * t.quantity - 
        (t.exchangeRate + t.brokerage), 
        0
      );

      dailyData[dateStr] = {
        ...dailyData[dateStr],
        winRate: Number(winRate.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        tradesTaken: dayTrades.length,
        hasMeaningfulData: dayTrades.length > 0 || dailyData[dateStr].hasMeaningfulData,
      };
    });

    // Process rule states - only mark as meaningful if rules are followed
    ruleStates.forEach(ruleState => {
      const dateStr = moment.utc(ruleState.date).format("YYYY-MM-DD");
      const dayRuleStates = ruleStates.filter(rs => 
        moment.utc(rs.date).isSame(ruleState.date, "day")
      );

      const activeRules = dayRuleStates.filter(rs => rs.isActive).length;
      const rulesFollowedCount = dayRuleStates.filter(rs => 
        rs.isActive && rs.isFollowed
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

    // Apply filters and only include dates with meaningful data
    const filteredData = Object.entries(dailyData)
      .filter(([_, data]) => data.hasMeaningfulData)
      .filter(([_, data]) => 
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

    // Apply pagination
    const totalItems = Object.keys(filteredData).length;
    const totalPages = Math.ceil(totalItems / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const paginatedData = Object.fromEntries(
      Object.entries(filteredData)
        .sort(([dateA], [dateB]) => new Date(dateB) - new Date(dateA)) // Sort by date descending
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

exports.getJournalDetails = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = moment.utc(date).startOf("day").toDate();

    const journal = await Journal.findOne({
      user: req.user._id,
      date: targetDate,
    });

    const rules = await Rule.find({ user: req.user._id });
    const ruleStates = await RuleState.find({
      user: req.user._id,
      date: targetDate,
    }).populate("rule");

    const rulesWithStatus = rules.map((rule) => {
      const ruleState = ruleStates.find(
        (rs) => rs.rule && rs.rule._id.toString() === rule._id.toString()
      );

      return {
        description: rule.description,
        isFollowed: ruleState ? ruleState.isFollowed : false,
        _id: rule._id,
      };
    });

    const trades = await Trade.find({
      user: req.user._id,
      date: {
        $gte: moment.utc(date).startOf("day").toDate(),
        $lte: moment.utc(date).endOf("day").toDate(),
      },
    })
      .select({
        date: 1,
        time: 1,
        instrumentName: 1,
        equityType: 1,
        action: 1,
        quantity: 1,
        buyingPrice: 1,
        sellingPrice: 1,
        exchangeRate: 1,
        brokerage: 1,
      })
      .sort({ time: 1 });

    let totalPnL = 0;
    let totalCharges = 0;
    let netPnL = 0;

    trades.forEach((trade) => {
      const grossPnL =
        (trade.sellingPrice - trade.buyingPrice) * trade.quantity;
      const charges = trade.exchangeRate + trade.brokerage;
      const tradePnL = grossPnL - charges;

      totalPnL += grossPnL;
      totalCharges += charges;
      netPnL += tradePnL;

      trade.grossPnL = grossPnL;
      trade.charges = { totalCharges: charges };
      trade.netPnL = tradePnL;
    });

    const journalDetails = {
      date: journal?.date,
      note: journal?.note,
      mistake: journal?.mistake,
      lesson: journal?.lesson,
      rules: rulesWithStatus,
      tags: journal?.tags,
      attachedFiles: journal?.attachedFiles,
      trades: trades,
    };

    res.json({
      journalDetails,
      summary: {
        totalTrades: trades.length,
        totalPnL: Number(totalPnL.toFixed(2)),
        totalCharges: Number(totalCharges.toFixed(2)),
        netPnL: Number(netPnL.toFixed(2)),
      },
    });
  } catch (error) {
    console.error("Error in getJournalDetails:", error);
    res.status(500).send({ error: error.message });
  }
};

module.exports = exports;