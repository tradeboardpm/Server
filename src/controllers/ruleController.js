const mongoose = require("mongoose");
const User = require("../models/User");
const Rule = require("../models/Rule");
const RuleState = require("../models/RuleState");

const normalizeDate = (dateString) => {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new Error("Invalid date format. Please use YYYY-MM-DD or ISO format.");
  }
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const updateUserPointsForRules = async (userId, date, session = null) => {
  const utcDate = normalizeDate(date);

  const ruleStates = await RuleState.find({
    user: userId,
    date: utcDate,
    isActive: true,
  }).session(session);

  const atLeastOneRuleFollowed = ruleStates.some((rule) => rule.isFollowed);

  const user = await User.findById(userId).session(session);
  user.pointsHistory = user.pointsHistory || [];

  const pointsEntry = user.pointsHistory.find(
    (entry) => entry.date.getTime() === utcDate.getTime()
  );

  if (atLeastOneRuleFollowed && (!pointsEntry || pointsEntry.pointsChange < 1)) {
    user.points += 1;
    if (pointsEntry) {
      pointsEntry.pointsChange = 1;
    } else {
      user.pointsHistory.push({ date: utcDate, pointsChange: 1 });
    }
    await user.save({ session });
    return 1;
  }

  if (!atLeastOneRuleFollowed && pointsEntry?.pointsChange > 0) {
    user.points -= 1;
    pointsEntry.pointsChange = -1;
    await user.save({ session });
    return -1;
  }

  return 0;
};

const getEffectiveRulesForDate = async (userId, date) => {
  const utcDate = normalizeDate(date);

  // Get all rule states up to this date
  const allStates = await RuleState.find({
    user: userId,
    date: { $lte: utcDate },
  })
    .sort({ date: 1 })
    .populate("rule");

  if (!allStates.length) {
    return [];
  }

  // Build rule states map considering only the state at each date
  const ruleStatesMap = new Map();
  allStates.forEach(state => {
    if (state.rule) {  // Ensure rule population worked
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

    await session.commitTransaction();
    res.status(201).json({
      _id: newRule._id,
      description: newRule.description,
      isFollowed: false,
      createdAt: newRule.createdAt,
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
    const originalRule = await Rule.findOne({ _id: req.params.id, user: req.user.id }).session(session);
    
    if (!originalRule) {
      throw new Error("Rule not found");
    }

    // Create a new rule with the updated description
    const newRule = new Rule({
      user: req.user.id,
      description: req.body.description,
      createdAt: utcDate,
    });
    await newRule.save({ session });

    // Set the new rule as active for this date
    const newState = new RuleState({
      user: req.user.id,
      rule: newRule._id,
      date: utcDate,
      isActive: true,
    });
    await newState.save({ session });

    // Get the previous state to maintain follow status
    const previousState = await RuleState.findOne({
      user: req.user.id,
      rule: req.params.id,
      date: { $lte: utcDate },
    }).sort({ date: -1 }).session(session);

    if (previousState && previousState.isFollowed) {
      await RuleState.findOneAndUpdate(
        { user: req.user.id, rule: newRule._id, date: utcDate },
        { isFollowed: true },
        { session }
      );
    }

    await session.commitTransaction();
    res.json({
      _id: newRule._id,
      description: newRule.description,
      isFollowed: previousState?.isFollowed || false,
      createdAt: newRule.createdAt,
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

    // Mark the rule as inactive only for this specific date
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
    if (!rule) {
      throw new Error("Rule not found");
    }

    const previousState = await RuleState.findOne({
      user: req.user.id,
      rule: ruleId,
      date: { $lte: utcDate },
    }).sort({ date: -1 }).session(session);

    const ruleState = await RuleState.findOneAndUpdate(
      { user: req.user.id, rule: ruleId, date: utcDate },
      { 
        isActive: previousState ? previousState.isActive : true,
        isFollowed 
      },
      { upsert: true, new: true, session }
    );

    const pointsChange = await updateUserPointsForRules(req.user.id, utcDate, session);

    await session.commitTransaction();
    res.json({ 
      ruleState: {
        _id: rule._id,
        description: rule.description,
        isFollowed: ruleState.isFollowed,
        createdAt: rule.createdAt,
      },
      pointsChange 
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({
      message: "Error following/unfollowing rule",
      error: error.message,
    });
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

    const newRules = await Promise.all(
      sampleRules.map(async (description) => {
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
    res.status(500).json({ message: "Error loading sample rules", error: error.message });
  } finally {
    session.endSession();
  }
};

// controllers/ruleController.js (relevant section only)

exports.bulkAddRules = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { rules, date } = req.body;

    // Validate input
    if (!Array.isArray(rules) || rules.length === 0) {
      throw new Error("Rules must be a non-empty array of descriptions");
    }

    const utcDate = normalizeDate(date || new Date());

    // Normalize rules to extract descriptions (handle both strings and objects)
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

    // Validate each rule description
    const invalidRules = ruleDescriptions.filter(
      (description) => !description || description === ""
    );

    if (invalidRules.length > 0) {
      throw new Error(
        `Invalid rule descriptions detected: ${invalidRules.map((r, i) => `Rule ${i + 1}`).join(", ")}. Each rule must have a valid non-empty description.`
      );
    }

    // Create rules and their states
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