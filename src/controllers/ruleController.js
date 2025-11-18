// controllers/ruleController.js
const mongoose = require("mongoose");
const Rule = require("../models/Rule");
const RuleState = require("../models/RuleState");
const User = require("../models/User");
const { updateUserPointsForToday } = require("../utils/pointsHelper");
const { normalizeDate } = require("../utils/dateHelper");

// ==================== SAMPLE RULES ====================
const sampleRules = [
  "Always adhere to your predefined strategy and rules for each trade.",
  "Limit the risk per trade to a small percentage of your total trading capital.",
  "Protect your capital by setting stop-loss orders.",
  "Continuously monitor market news and economic indicators.",
  "Prioritize high-quality trade setups.",
  "Make rational decisions based on your strategy.",
  "Regularly evaluate your trade history.",
  "Consistently follow your rules without impulsive deviations.",
  "Define achievable and measurable targets.",
  "Stay flexible and adjust your strategies as market conditions evolve.",
];

// ==================== HELPER: Ensure all rules exist as RuleState on a given date ====================
const ensureAllRulesExistOnDate = async (userId, targetDate, session) => {
  const existingStates = await RuleState.find(
    { user: userId, date: targetDate },
    { rule: 1 }
  ).session(session);

  const existingRuleIds = new Set(existingStates.map(s => s.rule.toString()));

  const allRules = await Rule.find({ user: userId }).session(session);

  const bulkOps = allRules
    .filter(rule => !existingRuleIds.has(rule._id.toString()))
    .map(rule => ({
      updateOne: {
        filter: { user: userId, rule: rule._id, date: targetDate },
        update: { isActive: true, isFollowed: false },
        upsert: true,
      },
    }));

  if (bulkOps.length > 0) {
    await RuleState.bulkWrite(bulkOps, { session });
  }
};

// ==================== GET RULES – NEVER DISAPPEAR (OLD LOGIC RESTORED) ====================
exports.getRules = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = normalizeDate(date || new Date());

    // Ensure all rules have a state for this date
    await ensureAllRulesExistOnDate(req.user._id, targetDate, null);

    const states = await RuleState.find({
      user: req.user._id,
      date: targetDate,
    })
      .populate("rule", "description createdAt")
      .sort({ "rule.createdAt": 1 })
      .lean();

    const result = states.map(s => ({
      _id: s.rule._id,
      description: s.rule.description,
      isFollowed: s.isFollowed,
      createdAt: s.rule.createdAt,
    }));

    res.json(result);
  } catch (error) {
    console.error("getRules error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ==================== LOAD SAMPLE RULES ====================
exports.loadSampleRules = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: "Date required" });
    const targetDate = normalizeDate(date);

    const created = [];
    for (const desc of sampleRules) {
      let rule = await Rule.findOne({
        user: req.user._id,
        description: { $regex: new RegExp(`^${desc}$`, "i") },
      }).session(session);

      if (!rule) {
        rule = new Rule({
          user: req.user._id,
          description: desc,
          createdAt: targetDate,
        });
        await rule.save({ session });
        created.push(rule);
      }
    }

    await ensureAllRulesExistOnDate(req.user._id, targetDate, session);
    const pointsChange = await updateUserPointsForToday(req.user._id, session);

    await session.commitTransaction();

    res.status(201).json({
      rules: created.map(r => ({ _id: r._id, description: r.description, isFollowed: false })),
      pointsChange,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("loadSampleRules error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

// ==================== BULK ADD RULES ====================
exports.bulkAddRules = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { rules, date } = req.body;
    if (!date || !Array.isArray(rules) || rules.length === 0)
      return res.status(400).json({ error: "Date and rules array required" });

    const targetDate = normalizeDate(date);
    const descriptions = rules.map(r => r.description?.trim()).filter(Boolean);

    const existing = await Rule.find({
      user: req.user._id,
      description: { $in: descriptions.map(d => new RegExp(`^${d}$`, "i")) },
    }).session(session);

    if (existing.length > 0)
      return res.status(400).json({ error: "Some rules already exist" });

    const created = [];
    for (const { description } of rules) {
      if (!description?.trim()) continue;
      const rule = new Rule({
        user: req.user._id,
        description: description.trim(),
        createdAt: targetDate,
      });
      await rule.save({ session });
      created.push(rule);
    }

    await ensureAllRulesExistOnDate(req.user._id, targetDate, session);
    const pointsChange = await updateUserPointsForToday(req.user._id, session);

    await session.commitTransaction();

    res.status(201).json({
      rules: created.map(r => ({ _id: r._id, description: r.description, isFollowed: false })),
      pointsChange,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("bulkAddRules error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

// ==================== ADD SINGLE RULE ====================
exports.addRule = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { description, date } = req.body;
    if (!description || !date) return res.status(400).json({ error: "Description and date required" });

    const targetDate = normalizeDate(date);

    const exists = await Rule.findOne({
      user: req.user._id,
      description: { $regex: new RegExp(`^${description.trim()}$`, "i") },
    }).session(session);

    if (exists) return res.status(400).json({ error: "Rule already exists" });

    const rule = new Rule({
      user: req.user._id,
      description: description.trim(),
      createdAt: targetDate,
    });
    await rule.save({ session });

    await ensureAllRulesExistOnDate(req.user._id, targetDate, session);
    const pointsChange = await updateUserPointsForToday(req.user._id, session);

    await session.commitTransaction();

    res.status(201).json({
      _id: rule._id,
      description: rule.description,
      isFollowed: false,
      createdAt: rule.createdAt,
      pointsChange,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("addRule error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

// ==================== FOLLOW / UNFOLLOW SINGLE ====================
exports.followUnfollowRule = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { ruleId, date, isFollowed } = req.body;
    if (!date || isFollowed === undefined) return res.status(400).json({ error: "Date and isFollowed required" });

    const targetDate = normalizeDate(date);

    const rule = await Rule.findOne({ _id: ruleId, user: req.user._id });
    if (!rule) return res.status(404).json({ error: "Rule not found" });

    await ensureAllRulesExistOnDate(req.user._id, targetDate, session);

    await RuleState.findOneAndUpdate(
      { user: req.user._id, rule: ruleId, date: targetDate },
      { isFollowed },
      { upsert: true, session }
    );

    const pointsChange = await updateUserPointsForToday(req.user._id, session);
    await session.commitTransaction();

    res.json({
      _id: rule._id,
      description: rule.description,
      isFollowed,
      pointsChange,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("followUnfollowRule error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

// ==================== FOLLOW / UNFOLLOW ALL ====================
exports.followUnfollowAllRules = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { date, isFollowed } = req.body;
    if (!date || isFollowed === undefined) return res.status(400).json({ error: "Date and isFollowed required" });

    const targetDate = normalizeDate(date);

    await ensureAllRulesExistOnDate(req.user._id, targetDate, session);

    await RuleState.updateMany(
      { user: req.user._id, date: targetDate },
      { isFollowed },
      { session }
    );

    const pointsChange = await updateUserPointsForToday(req.user._id, session);
    await session.commitTransaction();

    res.json({ message: "All rules updated", pointsChange });
  } catch (err) {
    await session.abortTransaction();
    console.error("followUnfollowAllRules error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

// ==================== DELETE RULE ====================
exports.deleteRule = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;

    const rule = await Rule.findOne({ _id: id, user: req.user._id });
    if (!rule) return res.status(404).json({ error: "Rule not found" });

    await Rule.deleteOne({ _id: id }).session(session);
    await RuleState.deleteMany({ rule: id }).session(session);

    const pointsChange = await updateUserPointsForToday(req.user._id, session);
    await session.commitTransaction();

    res.json({ message: "Rule deleted successfully", pointsChange });
  } catch (err) {
    await session.abortTransaction();
    console.error("deleteRule error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

// ==================== UPDATE RULE ====================
exports.updateRule = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { description } = req.body;

    const rule = await Rule.findOne({ _id: id, user: req.user._id }).session(session);
    if (!rule) return res.status(404).json({ error: "Rule not found" });

    if (description?.trim() && description.trim() !== rule.description) {
      const conflict = await Rule.findOne({
        user: req.user._id,
        description: { $regex: new RegExp(`^${description.trim()}$`, "i") },
        _id: { $ne: id },
      }).session(session);

      if (conflict) return res.status(400).json({ error: "Rule with this description already exists" });

      rule.description = description.trim();
      await rule.save({ session });
    }

    await session.commitTransaction();
    res.json({ _id: rule._id, description: rule.description, createdAt: rule.createdAt });
  } catch (err) {
    await session.abortTransaction();
    console.error("updateRule error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

module.exports = exports;