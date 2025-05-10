const mongoose = require("mongoose");
const Rule = require("../models/Rule");
const RuleState = require("../models/RuleState");
const { normalizeDate, updateUserPointsForActionToday } = require("../utils/pointsHelper");

// Helper function to get the master rule list based on authorityDate
const getMasterRuleList = async (userId, referenceDate) => {
  const utcDate = normalizeDate(referenceDate);

  // Find rules with an authorityDate less than or equal to the reference date
  const masterRules = await Rule.find({
    user: userId,
    authorityDate: { $lte: utcDate },
  });

  return masterRules.map((rule) => ({
    _id: rule._id,
    description: rule.description,
    isFollowed: false, // Default to false for master list rules
    createdAt: rule.createdAt,
    authorityDate: rule.authorityDate,
  }));
};

// Helper function to get effective rules for a specific date
const getEffectiveRulesForDate = async (userId, date) => {
  const utcDate = normalizeDate(date);

  // Get the master rule list for this date
  const masterRules = await getMasterRuleList(userId, utcDate);
  const masterRuleIds = new Set(masterRules.map((rule) => rule._id.toString()));

  // Get explicit rule states for the requested date
  const currentDateStates = await RuleState.find({
    user: userId,
    date: utcDate,
  }).populate("rule");

  // Create a map of rule states for the requested date
  const ruleStatesMap = new Map();
  currentDateStates.forEach((state) => {
    if (state.rule) {
      ruleStatesMap.set(state.rule._id.toString(), state);
    }
  });

  // Build the effective rule list
  const effectiveRules = [];
  for (const masterRule of masterRules) {
    const ruleId = masterRule._id.toString();
    const state = ruleStatesMap.get(ruleId);

    // Include the rule if it is active (either no state exists or state.isActive is true)
    // and its createdAt is less than or equal to the requested date
    if ((!state || state.isActive) && masterRule.createdAt <= utcDate) {
      effectiveRules.push({
        _id: masterRule._id,
        description: masterRule.description,
        isFollowed: state ? state.isFollowed : false,
        createdAt: masterRule.createdAt,
      });
    }
  }

  // Include any additional rules that have explicit active states for this date
  // but aren't in the master list (e.g., rules added on a past date)
  currentDateStates.forEach((state) => {
    const ruleId = state.rule._id.toString();
    if (
      state.isActive &&
      !masterRuleIds.has(ruleId) &&
      state.rule.createdAt <= utcDate
    ) {
      effectiveRules.push({
        _id: state.rule._id,
        description: state.rule.description,
        isFollowed: state.isFollowed,
        createdAt: state.rule.createdAt,
      });
    }
  });

  return effectiveRules;
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
      authorityDate: utcDate, // Set authorityDate to the date the rule is added
    });
    await newRule.save({ session });

    // Create a rule state for the specified date
    const ruleState = new RuleState({
      user: req.user.id,
      rule: newRule._id,
      date: utcDate,
      isActive: true,
      isFollowed: false,
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

    // Update rule description
    rule.description = req.body.description;
    // Only update authorityDate if the edit is on the current date
    const currentDate = normalizeDate(new Date());
    if (utcDate.getTime() === currentDate.getTime()) {
      rule.authorityDate = utcDate;
    }
    await rule.save({ session });

    // Update or create rule state for the specified date
    const ruleState = await RuleState.findOneAndUpdate(
      { user: req.user.id, rule: rule._id, date: utcDate },
      { isActive: true, isFollowed: false },
      { upsert: true, new: true, session }
    );

    // Ensure all master list rules have a RuleState for this date to preserve them
    const masterRules = await getMasterRuleList(req.user.id, utcDate);
    for (const masterRule of masterRules) {
      if (masterRule._id.toString() !== rule._id.toString()) {
        await RuleState.findOneAndUpdate(
          { user: req.user.id, rule: masterRule._id, date: utcDate },
          { isActive: true, isFollowed: false },
          { upsert: true, new: true, session }
        );
      }
    }

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

    // Mark the rule as inactive for the specified date
    await RuleState.findOneAndUpdate(
      { user: req.user.id, rule: req.params.id, date: utcDate },
      { isActive: false },
      { upsert: true, new: true, session }
    );

    // Update authorityDate if deleting on the current date
    const currentDate = normalizeDate(new Date());
    if (utcDate.getTime() === currentDate.getTime()) {
      rule.authorityDate = null; // Remove from master list
      await rule.save({ session });
    }

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

    // Update or create rule state for the specified date
    const ruleState = await RuleState.findOneAndUpdate(
      { user: req.user.id, rule: ruleId, date: utcDate },
      { isActive: true, isFollowed },
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

    // Get the master rule list for this date
    const rules = await getMasterRuleList(req.user.id, utcDate);
    if (!rules.length) {
      throw new Error("No rules found for this user");
    }

    // Update rule states for all rules on the specified date
    const updatedRules = await Promise.all(
      rules.map(async (rule) => {
        const ruleState = await RuleState.findOneAndUpdate(
          { user: req.user.id, rule: rule._id, date: utcDate },
          { isActive: true, isFollowed },
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
        authorityDate: utcDate,
      });
      await rule.save({ session });

      const ruleState = new RuleState({
        user: req.user.id,
        rule: rule._id,
        date: utcDate,
        isActive: true,
        isFollowed: false,
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
    res.status(500).json({ message: "Error loading sample rules", error: error.message });
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

    const newRules = [];
    for (const description of ruleDescriptions) {
      const rule = new Rule({
        user: req.user.id,
        description,
        createdAt: utcDate,
        authorityDate: utcDate,
      });
      await rule.save({ session });

      const ruleState = new RuleState({
        user: req.user.id,
        rule: rule._id,
        date: utcDate,
        isActive: true,
        isFollowed: false,
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
    res.status(400).json({ message: "Error adding bulk rules", error: error.message });
  } finally {
    session.endSession();
  }
};