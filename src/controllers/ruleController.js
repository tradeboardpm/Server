// controllers/ruleController.js
const mongoose = require("mongoose");
const Rule = require("../models/Rule");
const RuleState = require("../models/RuleState");
const User = require("../models/User");
const { updateUserPointsForToday } = require("../utils/pointsHelper");
const { normalizeDate } = require("../utils/dateHelper");
const { getEffectiveRulesForDate } = require("../utils/ruleHelper");

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

// ==================== HELPER: Copy states from fallback date if no states exist ====================
const ensureStatesExistOnDate = async (userId, targetDate, session) => {
  const existingStates = await RuleState.find({ user: userId, date: targetDate }).session(session);
  if (existingStates.length > 0) return; // Already exist, no need to copy

  // Find fallback date (closest future first, then previous)
  let fallbackDate = await RuleState.findOne({ user: userId, date: { $gt: targetDate } })
    .sort({ date: 1 })
    .select("date")
    .session(session);

  fallbackDate = fallbackDate ? fallbackDate.date : null;

  if (!fallbackDate) {
    fallbackDate = await RuleState.findOne({ user: userId, date: { $lt: targetDate } })
      .sort({ date: -1 })
      .select("date")
      .session(session);
    fallbackDate = fallbackDate ? fallbackDate.date : null;
  }

  if (!fallbackDate) return; // No rules anywhere, nothing to copy

  const fallbackStates = await RuleState.find({ user: userId, date: fallbackDate }).session(session);

  const bulkOps = fallbackStates.map(state => ({
    updateOne: {
      filter: { user: userId, rule: state.rule, date: targetDate },
      update: { isActive: true, isFollowed: false },
      upsert: true,
    },
  }));

  if (bulkOps.length > 0) {
    await RuleState.bulkWrite(bulkOps, { session });
  }
};

// ==================== GET RULES ====================
exports.getRules = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = normalizeDate(date || new Date());

    const rules = await getEffectiveRulesForDate(req.user._id, targetDate);

    res.json(rules);
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

    await ensureStatesExistOnDate(req.user._id, targetDate, session);

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

        const state = new RuleState({
          user: req.user._id,
          rule: rule._id,
          date: targetDate,
          isActive: true,
          isFollowed: false,
        });
        await state.save({ session });

        created.push(rule);
      }
    }

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

    await ensureStatesExistOnDate(req.user._id, targetDate, session);

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

      const state = new RuleState({
        user: req.user._id,
        rule: rule._id,
        date: targetDate,
        isActive: true,
        isFollowed: false,
      });
      await state.save({ session });

      created.push(rule);
    }

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

    await ensureStatesExistOnDate(req.user._id, targetDate, session);

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

    const state = new RuleState({
      user: req.user._id,
      rule: rule._id,
      date: targetDate,
      isActive: true,
      isFollowed: false,
    });
    await state.save({ session });

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

    await ensureStatesExistOnDate(req.user._id, targetDate, session);

    const state = await RuleState.findOneAndUpdate(
      { user: req.user._id, rule: ruleId, date: targetDate },
      { isFollowed },
      { upsert: true, new: true, session }
    );

    const pointsChange = await updateUserPointsForToday(req.user._id, session);
    await session.commitTransaction();

    res.json({
      _id: rule._id,
      description: rule.description,
      isFollowed: state.isFollowed,
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

    await ensureStatesExistOnDate(req.user._id, targetDate, session);

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
    const { date } = req.body; // Assume date is now provided; if not, adjust to require it
    if (!date) return res.status(400).json({ error: "Date required" });
    const targetDate = normalizeDate(date);

    const rule = await Rule.findOne({ _id: id, user: req.user._id });
    if (!rule) return res.status(404).json({ error: "Rule not found" });

    await ensureStatesExistOnDate(req.user._id, targetDate, session);

    await RuleState.deleteOne({
      user: req.user._id,
      rule: id,
      date: targetDate,
    }).session(session);

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
    const { description, date } = req.body;
    if (!description || !date) return res.status(400).json({ error: "Description and date required" });

    const targetDate = normalizeDate(date);

    const oldRule = await Rule.findOne({ _id: id, user: req.user._id }).session(session);
    if (!oldRule) return res.status(404).json({ error: "Rule not found" });

    await ensureStatesExistOnDate(req.user._id, targetDate, session);

    if (description?.trim() && description.trim() !== oldRule.description) {
      const conflict = await Rule.findOne({
        user: req.user._id,
        description: { $regex: new RegExp(`^${description.trim()}$`, "i") },
      }).session(session);

      if (conflict) return res.status(400).json({ error: "Rule with this description already exists" });

      const newRule = new Rule({
        user: req.user._id,
        description: description.trim(),
        createdAt: targetDate,
      });
      await newRule.save({ session });

      const state = await RuleState.findOne({
        user: req.user._id,
        rule: id,
        date: targetDate,
      }).session(session);

      if (state) {
        state.rule = newRule._id;
        await state.save({ session });
      }

      const pointsChange = await updateUserPointsForToday(req.user._id, session);

      await session.commitTransaction();
      res.json({ _id: newRule._id, description: newRule.description, createdAt: newRule.createdAt, pointsChange });
    } else {
      await session.commitTransaction();
      res.json({ _id: oldRule._id, description: oldRule.description, createdAt: oldRule.createdAt });
    }
  } catch (err) {
    await session.abortTransaction();
    console.error("updateRule error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

module.exports = exports;