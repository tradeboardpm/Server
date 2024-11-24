const Journal = require("../models/Journal");
const Rule = require("../models/Rule");
const User = require("../models/User");
const Trade = require("../models/Trade");
const moment = require("moment");
const { s3, upload } = require("../config/s3");

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

exports.getJournal = async (req, res) => {
  try {
    const date = moment(req.query.date).startOf("day");
    let journal = await Journal.findOne({ user: req.user._id, date });

    if (!journal) {
      // Check if rules exist
      const rulesExist = await Rule.exists({ user: req.user._id });
      if (!rulesExist) {
        return res
          .status(404)
          .send({ error: "No journal found and no rules exist" });
      }

      // Get all current rules for the user
      const allRules = await Rule.find({ user: req.user._id });

      journal = new Journal({
        user: req.user._id,
        date,
        rulesUnfollowed: allRules.map((rule) => ({
          description: rule.description,
          originalId: rule._id,
        })),
      });

      await journal.save();
    }

    res.status(200).send(journal);
  } catch (error) {
    console.error("Error in getJournal:", error);
    res.status(400).send({ error: error.message });
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
      await s3
        .deleteObject({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: key,
        })
        .promise();
    }

    res.send(journal);
  } catch (error) {
    console.error("Error in deleteJournal:", error);
    res.status(500).send({ error: error.message });
  }
};

exports.moveRule = async (req, res) => {
  try {
    const { journalId, ruleId, destination } = req.body;
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

    const ruleObject = {
      description: rule.description,
      originalId: rule._id,
    };

    if (destination === "followed") {
      journal.rulesFollowed.push(ruleObject);
      journal.rulesUnfollowed = journal.rulesUnfollowed.filter(
        (r) => r.originalId.toString() !== ruleId
      );
    } else if (destination === "unfollowed") {
      journal.rulesUnfollowed.push(ruleObject);
      journal.rulesFollowed = journal.rulesFollowed.filter(
        (r) => r.originalId.toString() !== ruleId
      );
    } else {
      return res.status(400).send({ error: "Invalid destination" });
    }

    await journal.save();
    res.status(200).send(journal);
  } catch (error) {
    console.error("Error in moveRule:", error);
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
