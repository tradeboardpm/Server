const Journal = require("../models/Journal");
const Rule = require("../models/Rule");
const RuleFollowed = require("../models/RuleFollowed");
const User = require("../models/User");
const Trade = require("../models/Trade");
const moment = require("moment");
const mongoose = require("mongoose");
const { s3Client } = require("../config/s3");
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { addPointsToUser } = require("../utils/pointsSystem");

exports.createOrUpdateJournal = async (req, res) => {
  try {
    console.log("Creating/Updating Journal - User ID:", req.user._id);
    console.log("Request Body:", JSON.stringify(req.body, null, 2));

    const date = moment.utc(req.body.date).startOf("day");
    let journal = await Journal.findOne({ user: req.user._id, date });

    let isNewJournal = false;
    if (!journal) {
      journal = new Journal({
        user: req.user._id,
        date,
      });
      isNewJournal = true;
      console.log("Creating new journal entry");
    } else {
      console.log("Updating existing journal entry");
    }

    // Track if significant changes were made
    const hasSignificantChanges =
      (!journal.note && req.body.note) ||
      (!journal.mistake && req.body.mistake) ||
      (!journal.lesson && req.body.lesson);

    // Update journal fields
    const hasNewNote = !journal.note && req.body.note;
    const hasNewMistake = !journal.mistake && req.body.mistake;
    const hasNewLesson = !journal.lesson && req.body.lesson;

    journal.note = req.body.note || journal.note;
    journal.mistake = req.body.mistake || journal.mistake;
    journal.lesson = req.body.lesson || journal.lesson;
    journal.tags = req.body.tags || journal.tags;

    // Logging journal content
    console.log("Journal Content:", {
      note: !!journal.note,
      mistake: !!journal.mistake,
      lesson: !!journal.lesson,
      tags: journal.tags,
    });

    // Handle file attachments
    if (req.files && req.files.length > 0) {
      if (journal.attachedFiles.length + req.files.length > 3) {
        return res
          .status(400)
          .send({ error: "Maximum of 3 files allowed per journal" });
      }

      // Encode the file location to handle special characters and spaces
      const encodedFiles = req.files.map((file) => encodeURI(file.location));

      journal.attachedFiles = journal.attachedFiles.concat(encodedFiles);
    }

    await journal.save();
    console.log("Journal saved successfully");

    // Attempt to add points for new or significantly changed content
    let pointsAdded = 0;
    if (isNewJournal || hasSignificantChanges) {
      console.log("Attempting to add points");

      // Add points for new content
      if (hasNewNote) pointsAdded++;
      if (hasNewMistake) pointsAdded++;
      if (hasNewLesson) pointsAdded++;

      // Add points to user if any new content exists
      if (pointsAdded > 0) {
        try {
          const totalPointsAdded = await addPointsToUser(
            req.user._id,
            date.toDate()
          );
          console.log(`Points added: ${totalPointsAdded}`);
        } catch (pointsError) {
          console.error("Error adding points:", pointsError);
        }
      }
    }

    // Ensure all rules are recorded for this date
    const allRules = await Rule.find({ user: req.user._id });
    const existingRulesFollowed = await RuleFollowed.find({
      user: req.user._id,
      date,
    });

    await Promise.all(
      allRules.map(async (rule) => {
        const ruleFollowed = existingRulesFollowed.find(
          (rf) => rf.rule.toString() === rule._id.toString()
        );
        if (!ruleFollowed) {
          await RuleFollowed.create({
            user: req.user._id,
            rule: rule._id,
            date,
            isFollowed: false,
          });
        }
      })
    );

    res.status(200).send(journal);
  } catch (error) {
    console.error("Error in createOrUpdateJournal:", error);
    res.status(400).send({ error: error.message });
  }
};

exports.deleteJournal = async (req, res) => {
  try {
    const journal = await Journal.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!journal) {
      return res.status(404).send({ error: "Journal not found" });
    }

    for (const fileUrl of journal.attachedFiles) {
      const key = fileUrl.split("/").pop();
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: key,
        })
      );
    }

    res.send(journal);
  } catch (error) {
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

    // Decode the fileKey to match the stored encoded URL
    const decodedFileKey = decodeURI(fileKey);

    const fileIndex = journal.attachedFiles.findIndex((file) =>
      decodeURI(file).endsWith(decodedFileKey)
    );

    if (fileIndex === -1) {
      return res.status(404).send({ error: "File not found in journal" });
    }

    // Extract the key for S3 deletion
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
    let journal = await Journal.findOne({ user: req.user._id, date });

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
    } = req.query;

    const startDate = moment
      .utc({ year: parseInt(year), month: parseInt(month) - 1 })
      .startOf("month");
    const endDate = moment
      .utc({ year: parseInt(year), month: parseInt(month) - 1 })
      .endOf("month");

    const journals = await Journal.find({
      user: req.user._id,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: 1 });

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startDate, $lte: endDate },
    });

    const rules = await Rule.find({ user: req.user._id });

    const rulesFollowed = await RuleFollowed.find({
      user: req.user._id,
      date: { $gte: startDate, $lte: endDate },
    });

    const monthlyData = {};

    for (const journal of journals) {
      const dateStr = moment.utc(journal.date).format("YYYY-MM-DD");
      const dayTrades = trades.filter((t) =>
        moment.utc(t.date).isSame(journal.date, "day")
      );

      const dayRulesFollowed = rulesFollowed.filter((rf) =>
        moment.utc(rf.date).isSame(journal.date, "day")
      );

      const rulesFollowedCount = dayRulesFollowed.filter(
        (rf) => rf.isFollowed
      ).length;
      const rulesFollowedPercentage = (rulesFollowedCount / rules.length) * 100;

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
      const tradesTaken = dayTrades.length;

      if (
        (minProfit && profit < parseFloat(minProfit)) ||
        (maxProfit && profit > parseFloat(maxProfit)) ||
        (minWinRate && winRate < parseFloat(minWinRate)) ||
        (maxWinRate && winRate > parseFloat(maxWinRate)) ||
        (minTrades && tradesTaken < parseInt(minTrades)) ||
        (maxTrades && tradesTaken > parseInt(maxTrades))
      ) {
        continue;
      }

      monthlyData[dateStr] = {
        note: journal.note,
        mistake: journal.mistake,
        lesson: journal.lesson,
        tags: journal.tags,
        rulesFollowedPercentage: Number(rulesFollowedPercentage.toFixed(2)),
        winRate: Number(winRate.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        tradesTaken,
      };
    }

    res.json(monthlyData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getFiltersJournals = async (req, res) => {
  try {
    const { startDate, endDate, minWinRate, maxWinRate, minTrades, maxTrades } =
      req.query;

    const start = moment.utc(startDate).startOf("day");
    const end = moment.utc(endDate).endOf("day");

    const journals = await Journal.find({
      user: req.user._id,
      date: { $gte: start.toDate(), $lte: end.toDate() },
    }).sort({ date: 1 });

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: start.toDate(), $lte: end.toDate() },
    });

    const rules = await Rule.find({ user: req.user._id });

    const rulesFollowed = await RuleFollowed.find({
      user: req.user._id,
      date: { $gte: start.toDate(), $lte: end.toDate() },
    });

    const journalData = {};

    for (const journal of journals) {
      const dateStr = moment.utc(journal.date).format("YYYY-MM-DD");
      const dayTrades = trades.filter((t) =>
        moment.utc(t.date).isSame(journal.date, "day")
      );

      const dayRulesFollowed = rulesFollowed.filter((rf) =>
        moment.utc(rf.date).isSame(journal.date, "day")
      );

      const rulesFollowedCount = dayRulesFollowed.filter(
        (rf) => rf.isFollowed
      ).length;
      const rulesFollowedPercentage = (rulesFollowedCount / rules.length) * 100;

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
      const tradesTaken = dayTrades.length;

      if (
        (minWinRate && winRate < parseFloat(minWinRate)) ||
        (maxWinRate && winRate > parseFloat(maxWinRate)) ||
        (minTrades && tradesTaken < parseInt(minTrades)) ||
        (maxTrades && tradesTaken > parseInt(maxTrades))
      ) {
        continue;
      }

      journalData[dateStr] = {
        note: journal.note,
        mistake: journal.mistake,
        lesson: journal.lesson,
        tags: journal.tags,
        rulesFollowedPercentage: Number(rulesFollowedPercentage.toFixed(2)),
        winRate: Number(winRate.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        tradesTaken,
      };
    }

    res.json(journalData);
  } catch (error) {
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
    const rulesFollowed = await RuleFollowed.find({
      user: req.user._id,
      date: targetDate,
    });

    const rulesWithStatus = rules.map((rule) => {
      const ruleFollowedRecord = rulesFollowed.find(
        (rf) => rf.rule.toString() === rule._id.toString()
      );

      return {
        description: rule.description,
        isFollowed: ruleFollowedRecord ? ruleFollowedRecord.isFollowed : false,
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
