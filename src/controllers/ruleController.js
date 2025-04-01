const mongoose = require("mongoose");
const User = require("../models/User");
const Rule = require("../models/Rule");
const RuleState = require("../models/RuleState");
const { normalizeDate, updateUserPointsForActionToday } = require("../utils/pointsHelper");

const getEffectiveRulesForDate = async (userId, date) => {
  const utcDate = normalizeDate(date);

  // Get all rule states up to and including this date
  const allStatesUpToDate = await RuleState.find({
    user: userId,
    date: { $lte: utcDate },
  })
    .sort({ date: 1 })
    .populate("rule");

  // If no states exist up to this date, fetch the latest rules from the most recent date
  if (!allStatesUpToDate.length) {
    // Find the latest date with rule states
    const latestState = await RuleState.findOne({
      user: userId,
    })
      .sort({ date: -1 })
      .populate("rule");

    if (!latestState) {
      return []; // No rules exist at all for this user
    }

    // Get all rules and their states from the latest date
    const latestDate = normalizeDate(latestState.date);
    const latestStates = await RuleState.find({
      user: userId,
      date: latestDate,
    }).populate("rule");

    const rulesMap = new Map();
    latestStates.forEach(state => {
      if (state.rule && state.isActive) {
        rulesMap.set(state.rule._id.toString(), {
          _id: state.rule._id,
          description: state.rule.description,
          isFollowed: false, // Default to false for older dates with no explicit state
          createdAt: state.rule.createdAt,
        });
      }
    });

    return Array.from(rulesMap.values());
  }

  // Build rule states map considering only the state at each date
  const ruleStatesMap = new Map();
  allStatesUpToDate.forEach(state => {
    if (state.rule) {
      const key = `${state.rule._id.toString()}-${state.date.toISOString()}`;
      ruleStatesMap.set(key, state);
    }
  });

  // Get states exactly at this date or the most recent before it
  const rulesMap = new Map();
  const rules = await Rule.find({ user: userId });
  for (const rule of rules) {
    const latestState = await RuleState.findOne({
      user: userId,
      rule: rule._id,
      date: { $lte: utcDate },
    })
      .sort({ date: -1 })
      .populate("rule");

    if (latestState && latestState.isActive) {
      const currentDateState = await RuleState.findOne({
        user: userId,
        rule: rule._id,
        date: utcDate,
      });

      rulesMap.set(rule._id.toString(), {
        _id: rule._id,
        description: rule.description,
        isFollowed: currentDateState ? currentDateState.isFollowed : (latestState.date.getTime() === utcDate.getTime() ? latestState.isFollowed : false),
        createdAt: rule.createdAt,
      });
    }
  }

  return Array.from(rulesMap.values());
};

exports.getRules = async (req, res) => {
  try {
    const date = req.query.date || new Date();
    const utcDate = normalizeDate(date);

    const rules = await getEffectiveRulesForDate(req.user.id, utcDate);
    res.json(rules);
  } catch (error) {
    res.status(500).json({ message: "Error fetching rules", error: error.message });
  }
};

exports.addRule = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const utcDate = normalizeDate(req.body.date || new Date());
    const newRule = new Rule({
      user: req.user.id,
      description: req.body.description,
      createdAt: utcDate,
    });
    await newRule.save({ session });

    const ruleState = new RuleState({
      user: req.user.id,
      rule: newRule._id,
      date: utcDate,
      isActive: true,
    });
    await ruleState.save({ session });

    const pointsChange = await updateUserPointsForActionToday(req.user.id, utcDate, session);

    await session.commitTransaction();
    res.status(201).json({
      _id: newRule._id,
      description: newRule.description,
      isFollowed: false,
      createdAt: newRule.createdAt,
      pointsChange,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ message: "Error adding rule", error: error.message });
  } finally {
    session.endSession();
  }
};

exports.updateRule = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const utcDate = normalizeDate(req.body.date || new Date());
    const rule = await Rule.findOne({ _id: req.params.id, user: req.user.id }).session(session);

    if (!rule) {
      throw new Error("Rule not found");
    }

    rule.description = req.body.description;
    await rule.save({ session });

    const previousState = await RuleState.findOne({
      user: req.user.id,
      rule: rule._id,
      date: { $lte: utcDate },
    }).sort({ date: -1 }).session(session);

    const ruleState = await RuleState.findOneAndUpdate(
      { user: req.user.id, rule: rule._id, date: utcDate },
      { 
        isActive: true,
        isFollowed: previousState ? previousState.isFollowed : false
      },
      { upsert: true, new: true, session }
    );

    await session.commitTransaction();
    res.json({
      _id: rule._id,
      description: rule.description,
      isFollowed: ruleState.isFollowed,
      createdAt: rule.createdAt,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ message: "Error updating rule", error: error.message });
  } finally {
    session.endSession();
  }
};

exports.deleteRule = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const utcDate = normalizeDate(req.body.date || new Date());
    const rule = await Rule.findOne({ _id: req.params.id, user: req.user.id }).session(session);
    
    if (!rule) {
      throw new Error("Rule not found");
    }

    const ruleState = await RuleState.findOneAndUpdate(
      { user: req.user.id, rule: req.params.id, date: utcDate },
      { isActive: false },
      { upsert: true, new: true, session }
    );

    await session.commitTransaction();
    res.json({ message: "Rule deleted successfully" });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ message: "Error deleting rule", error: error.message });
  } finally {
    session.endSession();
  }
};

exports.followUnfollowRule = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { ruleId, date, isFollowed } = req.body;
    const utcDate = normalizeDate(date);

    const rule = await Rule.findOne({ _id: ruleId, user: req.user.id }).session(session);
    if (!rule) throw new Error("Rule not found");

    const previousState = await RuleState.findOne({
      user: req.user.id,
      rule: ruleId,
      date: { $lte: utcDate },
    }).sort({ date: -1 }).session(session);

    const ruleState = await RuleState.findOneAndUpdate(
      { user: req.user.id, rule: ruleId, date: utcDate },
      { isActive: previousState ? previousState.isActive : true, isFollowed },
      { upsert: true, new: true, session }
    );

    const pointsChange = await updateUserPointsForActionToday(req.user.id, new Date(), session);

    await session.commitTransaction();
    res.json({
      ruleState: {
        _id: rule._id,
        description: rule.description,
        isFollowed: ruleState.isFollowed,
        createdAt: rule.createdAt,
      },
      pointsChange,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ message: "Error following/unfollowing rule", error: error.message });
  } finally {
    session.endSession();
  }
};

exports.followUnfollowAllRules = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { date, isFollowed } = req.body;
    const utcDate = normalizeDate(date || new Date());

    const rules = await Rule.find({ user: req.user.id }).session(session);
    if (!rules.length) {
      throw new Error("No rules found for this user");
    }

    const latestStates = await RuleState.find({
      user: req.user.id,
      rule: { $in: rules.map(r => r._id) },
      date: { $lte: utcDate },
    })
      .sort({ date: -1 })
      .session(session);

    const latestStateMap = new Map();
    latestStates.forEach(state => {
      latestStateMap.set(state.rule.toString(), state);
    });

    const updatedRules = await Promise.all(
      rules.map(async (rule) => {
        const previousState = latestStateMap.get(rule._id.toString());
        const ruleState = await RuleState.findOneAndUpdate(
          { user: req.user.id, rule: rule._id, date: utcDate },
          { isActive: previousState ? previousState.isActive : true, isFollowed },
          { upsert: true, new: true, session }
        );

        return {
          _id: rule._id,
          description: rule.description,
          isFollowed: ruleState.isFollowed,
          createdAt: rule.createdAt,
        };
      })
    );

    const pointsChange = await updateUserPointsForActionToday(req.user.id, utcDate, session);

    await session.commitTransaction();
    res.json({
      rules: updatedRules,
      pointsChange,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ message: "Error following/unfollowing all rules", error: error.message });
  } finally {
    session.endSession();
  }
};

exports.loadSampleRules = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const utcDate = normalizeDate(req.body.date || new Date());
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
      "Stay flexible and adjust your strategies as market conditions evolve."
    ];

    const newRules = [];
    for (const description of sampleRules) {
      const rule = new Rule({
        user: req.user.id,
        description,
        createdAt: utcDate,
      });
      await rule.save({ session });

      const ruleState = new RuleState({
        user: req.user.id,
        rule: rule._id,
        date: utcDate,
        isActive: true,
      });
      await ruleState.save({ session });

      newRules.push({
        _id: rule._id,
        description: rule.description,
        isFollowed: false,
        createdAt: rule.createdAt,
      });
    }

    await session.commitTransaction();
    res.status(201).json(newRules);
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ 
      message: "Error loading sample rules", 
      error: error.message 
    });
  } finally {
    session.endSession();
  }
};

exports.bulkAddRules = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { rules, date } = req.body;

    if (!Array.isArray(rules) || rules.length === 0) {
      throw new Error("Rules must be a non-empty array of descriptions");
    }

    const utcDate = normalizeDate(date || new Date());

    const ruleDescriptions = rules.map((rule) => {
      if (typeof rule === "string") {
        return rule.trim();
      } else if (rule && typeof rule === "object" && "description" in rule) {
        return rule.description && typeof rule.description === "string"
          ? rule.description.trim()
          : "";
      }
      return "";
    });

    const invalidRules = ruleDescriptions.filter(
      (description) => !description || description === ""
    );

    if (invalidRules.length > 0) {
      throw new Error(
        `Invalid rule descriptions detected: ${invalidRules.map((r, i) => `Rule ${i + 1}`).join(", ")}. Each rule must have a valid non-empty description.`
      );
    }

    const newRules = await Promise.all(
      ruleDescriptions.map(async (description) => {
        const rule = new Rule({
          user: req.user.id,
          description,
          createdAt: utcDate,
        });
        await rule.save({ session });

        const ruleState = new RuleState({
          user: req.user.id,
          rule: rule._id,
          date: utcDate,
          isActive: true,
        });
        await ruleState.save({ session });

        return {
          _id: rule._id,
          description: rule.description,
          isFollowed: false,
          createdAt: rule.createdAt,
        };
      })
    );

    await session.commitTransaction();
    res.status(201).json(newRules);
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ message: "Error adding bulk rules", error: error.message });
  } finally {
    session.endSession();
  }
};