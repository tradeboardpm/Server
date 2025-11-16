// controllers/ruleController.js
const mongoose = require("mongoose");
const Rule = require("../models/Rule");
const RuleState = require("../models/RuleState");
const moment = require("moment");
const { updateUserPointsForToday } = require("../utils/pointsHelper");
const { getEffectiveRulesForDate, normalizeDate } = require("../utils/ruleHelper");

// ---------------------------------------------------------------------
// SAMPLE RULES
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// GET RULES FOR A DATE (exact state or master fallback)
// ---------------------------------------------------------------------
exports.getRules = async (req, res) => {
  try {
    const { date } = req.query;
    const rules = await getEffectiveRulesForDate(req.user._id, date || new Date());
    res.json(rules);
  } catch (err) {
    console.error("getRules error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// LOAD SAMPLE RULES (creates master + state for given date)
// ---------------------------------------------------------------------
exports.loadSampleRules = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { date } = req.body;
    const targetDate = normalizeDate(date || new Date());

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
          authorityDate: targetDate,
        });
        await rule.save({ session });
      }

      const existingState = await RuleState.findOne({
        user: req.user._id,
        rule: rule._id,
        date: targetDate,
      }).session(session);

      if (!existingState) {
        const state = new RuleState({
          user: req.user._id,
          rule: rule._id,
          date: targetDate,
          isActive: true,
          isFollowed: false,
        });
        await state.save({ session });
      }

      created.push({
        _id: rule._id,
        description: rule.description,
        isFollowed: false,
        createdAt: rule.createdAt,
      });
    }

    const pointsChange = await updateUserPointsForToday(req.user._id, session);
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ rules: created, pointsChange });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("loadSampleRules error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// BULK ADD RULES
// ---------------------------------------------------------------------
exports.bulkAddRules = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { rules, date } = req.body;
    const targetDate = normalizeDate(date || new Date());

    if (!Array.isArray(rules) || rules.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Rules array required" });
    }

    const descriptions = rules.map(r => r.description?.trim()).filter(Boolean);
    const existing = await Rule.find({
      user: req.user._id,
      description: { $in: descriptions.map(d => new RegExp(`^${d}$`, "i")) },
    }).session(session);

    if (existing.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Some rules already exist" });
    }

    const created = [];
    for (const { description } of rules) {
      if (!description?.trim()) continue;

      const rule = new Rule({
        user: req.user._id,
        description: description.trim(),
        createdAt: targetDate,
        authorityDate: targetDate,
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

      created.push({
        _id: rule._id,
        description: rule.description,
        isFollowed: false,
        createdAt: rule.createdAt,
      });
    }

    const pointsChange = await updateUserPointsForToday(req.user._id, session);
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ rules: created, pointsChange });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("bulkAddRules error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// ADD SINGLE RULE
// ---------------------------------------------------------------------
exports.addRule = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { description, date } = req.body;
    const targetDate = normalizeDate(date || new Date());

    const exists = await Rule.findOne({
      user: req.user._id,
      description: { $regex: new RegExp(`^${description.trim()}$`, "i") },
    }).session(session);

    if (exists) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Rule already exists" });
    }

    const rule = new Rule({
      user: req.user._id,
      description: description.trim(),
      createdAt: targetDate,
      authorityDate: targetDate,
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
    session.endSession();

    res.status(201).json({
      _id: rule._id,
      description: rule.description,
      isFollowed: false,
      createdAt: rule.createdAt,
      pointsChange,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("addRule error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// UPDATE RULE DESCRIPTION
// ---------------------------------------------------------------------
exports.updateRule = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { description } = req.body;

    const rule = await Rule.findOne({ _id: id, user: req.user._id }).session(session);
    if (!rule) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "Rule not found" });
    }

    if (description && description.trim() !== rule.description) {
      const conflict = await Rule.findOne({
        user: req.user._id,
        description: { $regex: new RegExp(`^${description.trim()}$`, "i") },
        _id: { $ne: id },
      }).session(session);
      if (conflict) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "Description already used" });
      }
    }

    rule.description = description ? description.trim() : rule.description;
    await rule.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.json({
      _id: rule._id,
      description: rule.description,
      createdAt: rule.createdAt,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("updateRule error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// DELETE RULE (and all its states)
// ---------------------------------------------------------------------
exports.deleteRule = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;

    const rule = await Rule.findOne({ _id: id, user: req.user._id }).session(session);
    if (!rule) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "Rule not found" });
    }

    await Rule.deleteOne({ _id: id }).session(session);
    await RuleState.deleteMany({ rule: id }).session(session);

    const pointsChange = await updateUserPointsForToday(req.user._id, session);
    await session.commitTransaction();
    session.endSession();

    res.json({ message: "Rule deleted", pointsChange });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("deleteRule error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// FOLLOW / UNFOLLOW SINGLE RULE (exact date only)
// ---------------------------------------------------------------------
exports.followUnfollowRule = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { ruleId, date, isFollowed } = req.body;
    const targetDate = normalizeDate(date);

    const rule = await Rule.findOne({ _id: ruleId, user: req.user._id }).session(session);
    if (!rule) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "Rule not found" });
    }

    let state = await RuleState.findOne({
      user: req.user._id,
      rule: ruleId,
      date: targetDate,
    }).session(session);

    if (!state) {
      state = new RuleState({
        user: req.user._id,
        rule: ruleId,
        date: targetDate,
        isActive: true,
        isFollowed: isFollowed ?? false,
      });
    } else {
      state.isFollowed = isFollowed ?? !state.isFollowed;
    }
    await state.save({ session });

    const pointsChange = await updateUserPointsForToday(req.user._id, session);
    await session.commitTransaction();
    session.endSession();

    res.json({
      _id: rule._id,
      description: rule.description,
      isFollowed: state.isFollowed,
      createdAt: rule.createdAt,
      pointsChange,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("followUnfollowRule error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// FOLLOW / UNFOLLOW ALL RULES (exact date only)
// ---------------------------------------------------------------------
exports.followUnfollowAllRules = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { date, isFollowed } = req.body;
    const targetDate = normalizeDate(date);

    const masterRules = await Rule.find({
      user: req.user._id,
      authorityDate: { $ne: null },
    }).session(session);

    if (!masterRules.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "No master rules" });
    }

    const updated = [];
    for (const rule of masterRules) {
      let state = await RuleState.findOne({
        user: req.user._id,
        rule: rule._id,
        date: targetDate,
      }).session(session);

      if (!state) {
        state = new RuleState({
          user: req.user._id,
          rule: rule._id,
          date: targetDate,
          isActive: true,
          isFollowed,
        });
      } else {
        state.isFollowed = isFollowed;
      }
      await state.save({ session });

      updated.push({
        _id: rule._id,
        description: rule.description,
        isFollowed: state.isFollowed,
      });
    }

    const pointsChange = await updateUserPointsForToday(req.user._id, session);
    await session.commitTransaction();
    session.endSession();

    res.json({ rules: updated, pointsChange });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("followUnfollowAllRules error:", err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = exports;