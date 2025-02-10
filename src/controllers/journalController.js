const Journal = require("../models/Journal")
const Rule = require("../models/Rule")
const RuleFollowed = require("../models/RuleFollowed")
const User = require("../models/User")
const Trade = require("../models/Trade")
const moment = require("moment")
const mongoose = require("mongoose")
const { s3Client } = require("../config/s3")
const { DeleteObjectCommand } = require("@aws-sdk/client-s3")


// Helper function to manage user points
const manageUserPoints = async (userId, date, originalFields, newFields, session = null) => {
  const today = moment.utc().startOf('day');
  const journalDate = moment.utc(date).startOf('day');
  
  // Only process points for journals created/updated for the current date
  if (!journalDate.isSame(today, 'day')) {
    return 0;
  }

  let pointsChange = 0;

  // Calculate points for fields changing from empty to non-empty
  if (!originalFields.note && newFields.note) pointsChange += 1;
  if (!originalFields.mistake && newFields.mistake) pointsChange += 1;
  if (!originalFields.lesson && newFields.lesson) pointsChange += 1;

  // Calculate points for fields changing from non-empty to empty
  if (originalFields.note && !newFields.note) pointsChange -= 1;
  if (originalFields.mistake && !newFields.mistake) pointsChange -= 1;
  if (originalFields.lesson && !newFields.lesson) pointsChange -= 1;

  if (pointsChange !== 0) {
    const updateOperation = session ? { session } : {};
    await User.findOneAndUpdate(
      { _id: userId },
      { $inc: { points: pointsChange } },
      updateOperation
    );
  }

  return pointsChange;
};

// Modify the createOrUpdateJournal function
exports.createOrUpdateJournal = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const date = moment.utc(req.body.date).startOf("day");
    let journal = await Journal.findOne({ user: req.user._id, date });

    const originalFields = {
      note: journal?.note || "",
      mistake: journal?.mistake || "",
      lesson: journal?.lesson || ""
    };

    if (!journal) {
      journal = new Journal({
        user: req.user._id,
        date,
      });
    }

    // Update journal fields
    const newFields = {
      note: req.body.note || "",
      mistake: req.body.mistake || "",
      lesson: req.body.lesson || ""
    };

    journal.note = newFields.note;
    journal.mistake = newFields.mistake;
    journal.lesson = newFields.lesson;
    journal.tags = req.body.tags || [];

    // Handle file attachments
    if (req.files && req.files.length > 0) {
      if (journal.attachedFiles.length + req.files.length > 3) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).send({ error: "Maximum of 3 files allowed per journal" });
      }
      const encodedFiles = req.files.map((file) => encodeURI(file.location));
      journal.attachedFiles = journal.attachedFiles.concat(encodedFiles);
    }

    // Check if all fields are empty and there are no attached files
    if (
      !journal.note &&
      !journal.mistake &&
      !journal.lesson &&
      journal.tags.length === 0 &&
      journal.attachedFiles.length === 0
    ) {
      if (journal._id) {
        // Remove points before deleting journal
        await manageUserPoints(
          req.user._id, 
          date.toDate(), 
          originalFields,
          { note: "", mistake: "", lesson: "" },
          session
        );
        
        await Journal.findByIdAndDelete(journal._id).session(session);
        await session.commitTransaction();
        session.endSession();
        return res.status(200).send({ message: "Empty journal entry deleted" });
      } else {
        await session.commitTransaction();
        session.endSession();
        return res.status(200).send({ message: "No journal entry created" });
      }
    }

    // Update points based on field changes
    await manageUserPoints(
      req.user._id,
      date.toDate(),
      originalFields,
      newFields,
      session
    );

    await journal.save({ session });
    await session.commitTransaction();
    session.endSession();

    res.status(200).send(journal);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error in createOrUpdateJournal:", error);
    res.status(400).send({ error: error.message });
  }
};

// Modify the deleteJournal function to handle points
exports.deleteJournal = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { date } = req.params;
    const targetDate = new Date(date);

    // Find the journal before deletion to calculate points
    const journal = await Journal.findOne({
      date: targetDate,
      user: req.user._id,
    }).session(session);

    if (journal) {
      // Remove points for non-empty fields
      const originalFields = {
        note: journal.note || "",
        mistake: journal.mistake || "",
        lesson: journal.lesson || ""
      };

      await manageUserPoints(
        req.user._id,
        targetDate,
        originalFields,
        { note: "", mistake: "", lesson: "" },
        session
      );

      // Delete attached files from S3
      for (const fileUrl of journal.attachedFiles) {
        const key = fileUrl.split("/").pop();
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: key,
          })
        );
      }

      // Delete the journal
      await journal.deleteOne({ session });
    }

    // Delete rules followed for this date
    const deletedRules = await RuleFollowed.deleteMany({
      user: req.user._id,
      date: targetDate,
    }).session(session);

    // Handle trades
    const trades = await Trade.find({
      user: req.user._id,
      date: targetDate,
    }).session(session);

    let capitalChange = 0;
    for (const trade of trades) {
      if (trade.action === "both") {
        capitalChange -= trade.netPnl;
      }
      await Trade.deleteOne({ _id: trade._id }).session(session);
    }

    if (capitalChange !== 0) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(capitalChange, targetDate);
    }

    await session.commitTransaction();
    session.endSession();

    res.send({
      message: "Journal (if exists), trades, and rules deleted successfully",
      capitalChange,
      tradesDeleted: trades.length,
      rulesDeleted: deletedRules.deletedCount,
      journalDeleted: journal ? true : false,
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
    const { journalId, fileKey } = req.params
    const journal = await Journal.findOne({
      _id: journalId,
      user: req.user._id,
    })

    if (!journal) {
      return res.status(404).send({ error: "Journal not found" })
    }

    // Decode the fileKey to match the stored encoded URL
    const decodedFileKey = decodeURI(fileKey)

    const fileIndex = journal.attachedFiles.findIndex((file) => decodeURI(file).endsWith(decodedFileKey))

    if (fileIndex === -1) {
      return res.status(404).send({ error: "File not found in journal" })
    }

    // Extract the key for S3 deletion
    const s3Key = decodeURI(fileKey.split("/").pop())

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: s3Key,
      }),
    )

    journal.attachedFiles.splice(fileIndex, 1)
    await journal.save()

    res.send({ message: "File deleted successfully" })
  } catch (error) {
    console.error("Error in deleteFile:", error)
    res.status(500).send({ error: error.message })
  }
}

exports.getJournal = async (req, res) => {
  try {
    const date = moment.utc(req.query.date).startOf("day")
    const journal = await Journal.findOne({ user: req.user._id, date })

    if (!journal) {
      return res.status(404).send({ error: "No journal found for this date" })
    }

    res.status(200).send(journal)
  } catch (error) {
    console.error("Error in getJournal:", error)
    res.status(400).send({ error: error.message })
  }
}

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
    } = req.query

    const startDate = moment.utc({ year: Number.parseInt(year), month: Number.parseInt(month) - 1 }).startOf("month")
    const endDate = moment.utc({ year: Number.parseInt(year), month: Number.parseInt(month) - 1 }).endOf("month")

    const journals = await Journal.find({
      user: req.user._id,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: 1 })

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startDate, $lte: endDate },
    })

    const rules = await Rule.find({ user: req.user._id })

    const rulesFollowed = await RuleFollowed.find({
      user: req.user._id,
      date: { $gte: startDate, $lte: endDate },
    })

    const monthlyData = {}

    // Process journals and trades
    for (const journal of journals) {
      const dateStr = moment.utc(journal.date).format("YYYY-MM-DD")
      const dayTrades = trades.filter((t) => moment.utc(t.date).isSame(journal.date, "day"))

      const dayRulesFollowed = rulesFollowed.filter((rf) => moment.utc(rf.date).isSame(journal.date, "day"))

      const rulesFollowedCount = dayRulesFollowed.filter((rf) => rf.isFollowed).length
      const totalRules = rules.length

      // Include this date if at least one rule is followed, even if there's no other data
      if (
        rulesFollowedCount === 0 &&
        !journal.note &&
        !journal.mistake &&
        !journal.lesson &&
        journal.tags.length === 0 &&
        dayTrades.length === 0
      ) {
        continue
      }

      const rulesFollowedPercentage = (rulesFollowedCount / totalRules) * 100

      const winningTrades = dayTrades.filter(
        (t) => (t.sellingPrice - t.buyingPrice) * t.quantity - (t.exchangeRate + t.brokerage) > 0,
      )
      const winRate = (winningTrades.length / dayTrades.length) * 100 || 0
      const profit = dayTrades.reduce(
        (sum, t) => sum + (t.sellingPrice - t.buyingPrice) * t.quantity - (t.exchangeRate + t.brokerage),
        0,
      )
      const tradesTaken = dayTrades.length

      // Check if this date meets the filter criteria
      if (
        (minProfit && profit < Number.parseFloat(minProfit)) ||
        (maxProfit && profit > Number.parseFloat(maxProfit)) ||
        (minWinRate && winRate < Number.parseFloat(minWinRate)) ||
        (maxWinRate && winRate > Number.parseFloat(maxWinRate)) ||
        (minTrades && tradesTaken < Number.parseInt(minTrades)) ||
        (maxTrades && tradesTaken > Number.parseInt(maxTrades)) ||
        (minRulesFollowed && rulesFollowedPercentage < Number.parseFloat(minRulesFollowed)) ||
        (maxRulesFollowed && rulesFollowedPercentage > Number.parseFloat(maxRulesFollowed))
      ) {
        continue
      }

      monthlyData[dateStr] = {
        note: journal.note || "",
        mistake: journal.mistake || "",
        lesson: journal.lesson || "",
        tags: journal.tags || [],
        rulesFollowedPercentage: Number(rulesFollowedPercentage.toFixed(2)),
        winRate: Number(winRate.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        tradesTaken,
      }
    }

    res.json(monthlyData)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

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
    } = req.query

    const start = moment.utc(startDate).startOf("day")
    const end = moment.utc(endDate).endOf("day")

    const journals = await Journal.find({
      user: req.user._id,
      date: { $gte: start.toDate(), $lte: end.toDate() },
    }).sort({ date: 1 })

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: start.toDate(), $lte: end.toDate() },
    })

    const rules = await Rule.find({ user: req.user._id })

    const rulesFollowed = await RuleFollowed.find({
      user: req.user._id,
      date: { $gte: start.toDate(), $lte: end.toDate() },
    })

    const journalData = {}

    for (const journal of journals) {
      const dateStr = moment.utc(journal.date).format("YYYY-MM-DD")
      const dayTrades = trades.filter((t) => moment.utc(t.date).isSame(journal.date, "day"))

      const dayRulesFollowed = rulesFollowed.filter((rf) => moment.utc(rf.date).isSame(journal.date, "day"))

      const rulesFollowedCount = dayRulesFollowed.filter((rf) => rf.isFollowed).length
      const rulesFollowedPercentage = (rulesFollowedCount / rules.length) * 100

      const winningTrades = dayTrades.filter(
        (t) => (t.sellingPrice - t.buyingPrice) * t.quantity - (t.exchangeRate + t.brokerage) > 0,
      )
      const winRate = (winningTrades.length / dayTrades.length) * 100 || 0
      const profit = dayTrades.reduce(
        (sum, t) => sum + (t.sellingPrice - t.buyingPrice) * t.quantity - (t.exchangeRate + t.brokerage),
        0,
      )
      const tradesTaken = dayTrades.length

      // Check if there's any non-empty content or at least one rule followed
      const hasContent =
        dayTrades.length > 0 ||
        rulesFollowedCount > 0 ||
        (journal.note && journal.note.trim() !== "") ||
        (journal.mistake && journal.mistake.trim() !== "") ||
        (journal.lesson && journal.lesson.trim() !== "") ||
        journal.tags.length > 0

      // Include this journal if it has content or at least one rule is followed
      if (hasContent) {
        journalData[dateStr] = {
          note: journal.note || "",
          mistake: journal.mistake || "",
          lesson: journal.lesson || "",
          tags: journal.tags || [],
          rulesFollowedPercentage: Number(rulesFollowedPercentage.toFixed(2)),
          winRate: Number(winRate.toFixed(2)),
          profit: Number(profit.toFixed(2)),
          tradesTaken,
        }
      }
    }

    // Pagination
    const totalItems = Object.keys(journalData).length
    const totalPages = Math.ceil(totalItems / limit)
    const startIndex = (page - 1) * limit
    const endIndex = page * limit

    const paginatedData = Object.fromEntries(Object.entries(journalData).slice(startIndex, endIndex))

    res.json({
      data: paginatedData,
      pagination: {
        currentPage: Number.parseInt(page),
        totalPages,
        totalItems,
        limit: Number.parseInt(limit),
      },
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

exports.getJournalDetails = async (req, res) => {
  try {
    const { date } = req.query
    const targetDate = moment.utc(date).startOf("day").toDate()

    const journal = await Journal.findOne({
      user: req.user._id,
      date: targetDate,
    })

    const rules = await Rule.find({ user: req.user._id })
    const rulesFollowed = await RuleFollowed.find({
      user: req.user._id,
      date: targetDate,
    })

    const rulesWithStatus = rules.map((rule) => {
      const ruleFollowedRecord = rulesFollowed.find((rf) => rf.rule.toString() === rule._id.toString())

      return {
        description: rule.description,
        isFollowed: ruleFollowedRecord ? ruleFollowedRecord.isFollowed : false,
        _id: rule._id,
      }
    })

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
      .sort({ time: 1 })

    let totalPnL = 0
    let totalCharges = 0
    let netPnL = 0

    trades.forEach((trade) => {
      const grossPnL = (trade.sellingPrice - trade.buyingPrice) * trade.quantity
      const charges = trade.exchangeRate + trade.brokerage
      const tradePnL = grossPnL - charges

      totalPnL += grossPnL
      totalCharges += charges
      netPnL += tradePnL

      trade.grossPnL = grossPnL
      trade.charges = { totalCharges: charges }
      trade.netPnL = tradePnL
    })

    const journalDetails = {
      date: journal?.date,
      note: journal?.note,
      mistake: journal?.mistake,
      lesson: journal?.lesson,
      rules: rulesWithStatus,
      tags: journal?.tags,
      attachedFiles: journal?.attachedFiles,
      trades: trades,
    }

    res.json({
      journalDetails,
      summary: {
        totalTrades: trades.length,
        totalPnL: Number(totalPnL.toFixed(2)),
        totalCharges: Number(totalCharges.toFixed(2)),
        netPnL: Number(netPnL.toFixed(2)),
      },
    })
  } catch (error) {
    console.error("Error in getJournalDetails:", error)
    res.status(500).send({ error: error.message })
  }
}

module.exports = exports

