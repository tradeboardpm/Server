const Journal = require("../models/Journal");
const Rule = require("../models/Rule");
const User = require("../models/User");
const Trade = require("../models/Trade");
const moment = require("moment");
const mongoose = require("mongoose");
const { s3Client, upload } = require("../config/s3");
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");

exports.createOrUpdateJournal = async (req, res) => {
  try {
    const date = moment.utc(req.body.date).startOf("day");
    let journal = await Journal.findOne({ user: req.user._id, date });

    // Check if rules exist
    const rulesExist = await Rule.exists({ user: req.user._id });
    if (!rulesExist) {
      return res
        .status(400)
        .send({ error: "Please create rules before creating a journal" });
    }

    // Get all current rules for the user
    const allRules = await Rule.find({ user: req.user._id });

    if (!journal) {
      // Creating a new journal
      journal = new Journal({
        user: req.user._id,
        date,
        rulesUnfollowed: allRules.map((rule) => ({
          description: rule.description,
          originalId: rule._id,
        })),
      });
    } else {
      // Updating an existing journal
      // We don't modify existing rules in the journal
    }

    // Update journal fields
    journal.note = req.body.note || journal.note;
    journal.mistake = req.body.mistake || journal.mistake;
    journal.lesson = req.body.lesson || journal.lesson;
    journal.tags = req.body.tags || journal.tags;

    // Handle file uploads
    if (req.files && req.files.length > 0) {
      // Check if adding new files would exceed the limit
      if (journal.attachedFiles.length + req.files.length > 3) {
        return res
          .status(400)
          .send({ error: "Maximum of 3 files allowed per journal" });
      }
      journal.attachedFiles = journal.attachedFiles.concat(
        req.files.map((file) => file.location)
      );
    }

    await journal.save();

    // Add points to user
    await addPointsToUser(req.user._id, date);

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

    const fileIndex = journal.attachedFiles.findIndex((file) =>
      file.endsWith(fileKey)
    );

    if (fileIndex === -1) {
      return res.status(404).send({ error: "File not found in journal" });
    }

    // Remove file from S3
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: fileKey,
      })
    );

    // Remove file from journal
    journal.attachedFiles.splice(fileIndex, 1);
    await journal.save();

    res.send({ message: "File deleted successfully" });
  } catch (error) {
    console.error("Error in deleteFile:", error);
    res.status(500).send({ error: error.message });
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

    const monthlyData = {};

    journals.forEach((journal) => {
      const dateStr = moment.utc(journal.date).format("YYYY-MM-DD");
      const dayTrades = trades.filter((t) =>
        moment.utc(t.date).isSame(journal.date, "day")
      );

      const rulesFollowedPercentage =
        (journal.rulesFollowed.length /
          (journal.rulesFollowed.length + journal.rulesUnfollowed.length)) *
        100;
      const winRate =
        (dayTrades.filter((t) => t.netPnL > 0).length / dayTrades.length) *
          100 || 0;
      const profit = dayTrades.reduce((sum, t) => sum + (t.netPnL || 0), 0);
      const tradesTaken = dayTrades.length;

      // Apply filters
      if (
        (minProfit && profit < parseFloat(minProfit)) ||
        (maxProfit && profit > parseFloat(maxProfit)) ||
        (minWinRate && winRate < parseFloat(minWinRate)) ||
        (maxWinRate && winRate > parseFloat(maxWinRate)) ||
        (minTrades && tradesTaken < parseInt(minTrades)) ||
        (maxTrades && tradesTaken > parseInt(maxTrades)) ||
        (minRulesFollowed &&
          rulesFollowedPercentage < parseFloat(minRulesFollowed)) ||
        (maxRulesFollowed &&
          rulesFollowedPercentage > parseFloat(maxRulesFollowed))
      ) {
        return;
      }

      monthlyData[dateStr] = {
        note: journal.note,
        mistake: journal.mistake,
        lesson: journal.lesson,
        tags: journal.tags,
        rulesFollowedPercentage,
        winRate,
        profit,
        tradesTaken,
      };
    });

    res.json(monthlyData);
  } catch (error) {
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
    } = req.query;

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

    const journalData = {};

    journals.forEach((journal) => {
      const dateStr = moment.utc(journal.date).format("YYYY-MM-DD");
      const dayTrades = trades.filter((t) =>
        moment.utc(t.date).isSame(journal.date, "day")
      );

      const rulesFollowedPercentage =
        (journal.rulesFollowed.length /
          (journal.rulesFollowed.length + journal.rulesUnfollowed.length)) *
        100;
      const winRate =
        (dayTrades.filter((t) => t.netPnL > 0).length / dayTrades.length) *
          100 || 0;
      const profit = dayTrades.reduce((sum, t) => sum + (t.netPnL || 0), 0);
      const tradesTaken = dayTrades.length;

      // Apply filters
      if (
        (minWinRate && winRate < parseFloat(minWinRate)) ||
        (maxWinRate && winRate > parseFloat(maxWinRate)) ||
        (minTrades && tradesTaken < parseInt(minTrades)) ||
        (maxTrades && tradesTaken > parseInt(maxTrades)) ||
        (minRulesFollowed &&
          rulesFollowedPercentage < parseFloat(minRulesFollowed)) ||
        (maxRulesFollowed &&
          rulesFollowedPercentage > parseFloat(maxRulesFollowed))
      ) {
        return;
      }

      journalData[dateStr] = {
        note: journal.note,
        mistake: journal.mistake,
        lesson: journal.lesson,
        tags: journal.tags,
        rulesFollowedPercentage,
        winRate,
        profit,
        tradesTaken,
      };
    });

    res.json(journalData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


exports.getJournal = async (req, res) => {
  try {
    const date = moment.utc(req.query.date).startOf("day");
    let journal = await Journal.findOne({ user: req.user._id, date });

    if (!journal) {
      // If no journal exists for the given date, just return null
      // instead of creating a new journal
      return res.status(404).send({ error: "No journal found for this date" });
    }

    res.status(200).send(journal);
  } catch (error) {
    console.error("Error in getJournal:", error);
    res.status(400).send({ error: error.message });
  }
};

exports.addRule = async (req, res) => {
  try {
    const { journalId, description } = req.body;
    const journal = await Journal.findOne({
      _id: journalId,
      user: req.user._id,
    });

    if (!journal) {
      return res.status(404).send({ error: "Journal not found" });
    }

    const today = moment.utc().startOf("day");
    const isCurrentDate = moment.utc(journal.date).isSame(today, "day");

    let newRule;

    if (isCurrentDate) {
      // If it's the current date, add to main rules collection
      newRule = new Rule({
        user: req.user._id,
        description,
      });
      await newRule.save();
    } else {
      // For past dates, create a temporary rule object
      newRule = {
        _id: new mongoose.Types.ObjectId(),
        description,
      };
    }

    journal.rulesUnfollowed.push({
      description: newRule.description,
      originalId: newRule._id,
    });

    await journal.save();
    res.status(201).send(journal);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.editRuleInJournal = async (req, res) => {
  try {
    const { journalId, ruleId, newDescription, isFollowed } = req.body;
    const journal = await Journal.findOne({
      _id: journalId,
      user: req.user._id,
    });

    if (!journal) {
      return res.status(404).send({ error: "Journal not found" });
    }

    const ruleArray = isFollowed
      ? journal.rulesFollowed
      : journal.rulesUnfollowed;
    const ruleIndex = ruleArray.findIndex(
      (rule) => rule.originalId.toString() === ruleId
    );

    if (ruleIndex === -1) {
      return res
        .status(404)
        .send({ error: "Rule not found in the specified array" });
    }

    ruleArray[ruleIndex].description = newDescription;
    await journal.save();

    const today = moment.utc().startOf("day");
    const isCurrentDate = moment.utc(journal.date).isSame(today, "day");

    if (isCurrentDate) {
      // Update the original rule in the Rule collection only for the current date
      await Rule.findByIdAndUpdate(ruleId, { description: newDescription });
    }

    res.send(journal);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.deleteRuleFromJournal = async (req, res) => {
  try {
    const { journalId, ruleId, isFollowed } = req.body;
    const journal = await Journal.findOne({
      _id: journalId,
      user: req.user._id,
    });

    if (!journal) {
      return res.status(404).send({ error: "Journal not found" });
    }

    const arrayName = isFollowed ? "rulesFollowed" : "rulesUnfollowed";
    journal[arrayName] = journal[arrayName].filter(
      (rule) => rule.originalId.toString() !== ruleId
    );

    await journal.save();

    const today = moment.utc().startOf("day");
    const isCurrentDate = moment.utc(journal.date).isSame(today, "day");

    if (isCurrentDate) {
      // Delete the original rule from the Rule collection only for the current date
      await Rule.findByIdAndDelete(ruleId);
    }

    res.send(journal);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.followUnfollowRule = async (req, res) => {
  try {
    const { journalId, ruleId, isFollowed } = req.body;
    const journal = await Journal.findOne({
      _id: journalId,
      user: req.user._id,
    });

    if (!journal) {
      return res.status(404).send({ error: "Journal not found" });
    }

    const rule = await Rule.findOne({ _id: ruleId, user: req.user._id });

    if (!rule) {
      return res.status(404).send({ error: "Rule not found" });
    }

    const sourceArray = isFollowed ? "rulesUnfollowed" : "rulesFollowed";
    const targetArray = isFollowed ? "rulesFollowed" : "rulesUnfollowed";

    const ruleIndex = journal[sourceArray].findIndex(
      (r) => r.originalId.toString() === ruleId
    );

    if (ruleIndex === -1) {
      // If the rule is not in the source array, add it to the target array
      journal[targetArray].push({
        description: rule.description,
        originalId: rule._id,
      });
    } else {
      // Move the rule from source to target array
      const [movedRule] = journal[sourceArray].splice(ruleIndex, 1);
      journal[targetArray].push(movedRule);
    }

    await journal.save();
    res.send(journal);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.followUnfollowAll = async (req, res) => {
  try {
    const { journalId, isFollowed } = req.body;
    const journal = await Journal.findOne({
      _id: journalId,
      user: req.user._id,
    });

    if (!journal) {
      return res.status(404).send({ error: "Journal not found" });
    }

    const sourceArray = isFollowed ? "rulesUnfollowed" : "rulesFollowed";
    const targetArray = isFollowed ? "rulesFollowed" : "rulesUnfollowed";

    // Move all rules from source to target array
    journal[targetArray] = [...journal[targetArray], ...journal[sourceArray]];
    journal[sourceArray] = [];

    await journal.save();
    res.send(journal);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.getJournalDetails = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).send({ error: "Date is required" });
    }

    const targetDate = moment.utc(date).startOf("day").toDate();

    // Fetch the journal for the specific date
    const journal = await Journal.findOne({
      user: req.user._id,
      date: targetDate,
    });

    if (!journal) {
      return res.status(404).send({ error: "No journal found for this date" });
    }

    // Fetch trades for the specific date with only specified fields
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
        grossPnL: 1,
        netPnL: 1,
        charges: 1,
      })
      .sort({ time: 1 });

    // Calculate summary statistics
    let totalPnL = 0;
    let totalCharges = 0;
    let netPnL = 0;

    trades.forEach((trade) => {
      if (trade.grossPnL) totalPnL += trade.grossPnL;
      if (trade.charges && trade.charges.totalCharges)
        totalCharges += trade.charges.totalCharges;
      if (trade.netPnL) netPnL += trade.netPnL;
    });

    // Prepare the details
    const journalDetails = {
      date: journal.date,
      note: journal.note,
      mistake: journal.mistake,
      lesson: journal.lesson,
      rulesFollowed: journal.rulesFollowed.map((rule) => ({
        description: rule.description,
        originalId: rule.originalId,
      })),
      rulesUnfollowed: journal.rulesUnfollowed.map((rule) => ({
        description: rule.description,
        originalId: rule.originalId,
      })),
      tags: journal.tags,
      attachedFiles: journal.attachedFiles,
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

async function addPointsToUser(userId, date) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const journal = await Journal.findOne({ user: userId, date });
    const trade = await Trade.findOne({ user: userId, date });

    let pointsToAdd = 0;
    if (journal) {
      if (journal.note) pointsToAdd++;
      if (journal.mistake) pointsToAdd++;
      if (journal.lesson) pointsToAdd++;
      if (journal.rulesFollowed.length > 0) pointsToAdd++;
    }
    if (trade) pointsToAdd++;

    user.points += pointsToAdd;
    user.lastPointsUpdate = date;
    await user.save();
  } catch (error) {
    console.error("Error adding points to user:", error);
  }
}