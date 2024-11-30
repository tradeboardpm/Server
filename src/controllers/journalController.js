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
    const date = moment(req.body.date).startOf("day");
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
    const { year, month } = req.query;
    const startOfMonth = moment(`${year}-${month}-01`).startOf("month");
    const endOfMonth = moment(startOfMonth).endOf("month");

    const journals = await Journal.find({
      user: req.user._id,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    }).sort({ date: 1 });

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    const monthlyData = {};

    journals.forEach((journal) => {
      const dateStr = moment(journal.date).format("YYYY-MM-DD");
      const dayTrades = trades.filter((t) =>
        moment(t.date).isSame(journal.date, "day")
      );

      monthlyData[dateStr] = {
        note: journal.note,
        mistake: journal.mistake,
        lesson: journal.lesson,
        tags: journal.tags,
        rulesFollowedPercentage:
          (journal.rulesFollowed.length /
            (journal.rulesFollowed.length + journal.rulesUnfollowed.length)) *
          100,
        winRate:
          (dayTrades.filter((t) => t.profitOrLoss > 0).length /
            dayTrades.length) *
            100 || 0,
        profit: dayTrades.reduce((sum, t) => sum + t.profitOrLoss, 0),
        tradesTaken: dayTrades.length,
      };
    });

    // Apply filters if provided
    const { profit, loss, tradesTaken, winRate, rulesFollowed } = req.query;
    const filteredData = Object.entries(monthlyData).filter(([date, data]) => {
      if (profit && data.profit <= 0) return false;
      if (loss && data.profit >= 0) return false;
      if (tradesTaken && data.tradesTaken < parseInt(tradesTaken)) return false;
      if (winRate && data.winRate < parseFloat(winRate)) return false;
      if (
        rulesFollowed &&
        data.rulesFollowedPercentage < parseFloat(rulesFollowed)
      )
        return false;
      return true;
    });

    res.json(Object.fromEntries(filteredData));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


exports.getJournal = async (req, res) => {
  try {
    const date = moment(req.query.date).startOf("day");
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

    const today = moment().startOf("day");
    const isCurrentDate = moment(journal.date).isSame(today, "day");

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

    const today = moment().startOf("day");
    const isCurrentDate = moment(journal.date).isSame(today, "day");

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

    const today = moment().startOf("day");
    const isCurrentDate = moment(journal.date).isSame(today, "day");

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
    const { journalId, ruleId, follow } = req.body;
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

    const sourceArray = follow ? "rulesUnfollowed" : "rulesFollowed";
    const targetArray = follow ? "rulesFollowed" : "rulesUnfollowed";

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
