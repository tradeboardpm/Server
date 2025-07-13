const mongoose = require("mongoose");
const Rule = require("../models/Rule");
const RuleState = require("../models/RuleState");
const User = require("../models/User");
const Trade = require("../models/Trade");
const Journal = require("../models/Journal");
const { normalizeDate, updateUserPointsForActionToday } = require("../utils/pointsHelper");

// Helper function to check if a journal exists for a specific date
const hasJournalForDate = async (userId, date, session) => {
  const utcDate = normalizeDate(date);
  
  // Check if any journal entry exists for this date
  const journal = await Journal.findOne({
    user: userId,
    date: utcDate,
  }).session(session);
  
  // Check if any trades exist for this date
  const trades = await Trade.find({
    user: userId,
    date: utcDate,
  }).session(session);
  
  // Check if any rule states exist for this date
  const ruleStates = await RuleState.find({
    user: userId,
    date: utcDate,
  }).session(session);
  
  return !!(journal || trades.length > 0 || ruleStates.length > 0);
};

// Helper function to get or set the master date for a user
const getOrSetMasterDate = async (userId, session, newDate = null, updateIfLater = false) => {
  const utcDate = newDate ? normalizeDate(newDate) : null;
  let user = await User.findById(userId).session(session);

  // If user has no master date and no new date is provided, return null
  if (!user.masterDate && !newDate) {
    return null;
  }

  // If user has no master date and a new date is provided, set it
  if (!user.masterDate && newDate) {
    user.masterDate = utcDate;
    await user.save({ session });
    return utcDate;
  }

  // If updating with a later date
  if (newDate && updateIfLater && utcDate > user.masterDate) {
    user.masterDate = utcDate;
    await user.save({ session });
    
    // Update authorityDate for all active rules on the new master date
    await updateMasterRulesAuthorityDate(userId, utcDate, session);
    
    return utcDate;
  }

  return user.masterDate;
};

// Helper function to update authorityDate for all active rules on the master date
const updateMasterRulesAuthorityDate = async (userId, masterDate, session) => {
  // Get all active rule states for the master date
  const masterRuleStates = await RuleState.find({
    user: userId,
    date: masterDate,
    isActive: true,
  }).session(session);

  // Update authorityDate for all rules that are active on the master date
  for (const ruleState of masterRuleStates) {
    await Rule.findByIdAndUpdate(
      ruleState.rule,
      { authorityDate: masterDate },
      { session }
    );
  }
};

// Helper function to get the master rule list based on the current master date
const getMasterRuleList = async (userId, session) => {
  // Fetch the current master date without updating it
  const masterDate = await getOrSetMasterDate(userId, session);
  
  // If no master date exists, return empty array
  if (!masterDate) {
    return [];
  }

  // Find rule states for the master date
  const masterRuleStates = await RuleState.find({
    user: userId,
    date: masterDate,
    isActive: true,
  })
    .populate("rule")
    .session(session);

  return masterRuleStates
    .filter((state) => state.rule)
    .map((state) => ({
      _id: state.rule._id,
      description: state.rule.description,
      isFollowed: state.isFollowed,
      createdAt: state.rule.createdAt,
      authorityDate: state.rule.authorityDate || masterDate,
    }));
};

// Helper function to check if rules exist for a specific date
const hasRulesForDate = async (userId, date, session) => {
  const utcDate = normalizeDate(date);
  const ruleStates = await RuleState.find({
    user: userId,
    date: utcDate,
  }).session(session);
  return ruleStates.length > 0;
};

// Helper function to copy master rules to a specific date (only when journal is created)
const copyMasterRulesToDate = async (userId, targetDate, session) => {
  const utcDate = normalizeDate(targetDate);
  const masterRules = await getMasterRuleList(userId, session);

  for (const rule of masterRules) {
    // Don't create new Rule documents, just create RuleState entries for existing rules
    const ruleState = new RuleState({
      user: userId,
      rule: rule._id, // Use the existing rule ID
      date: utcDate,
      isActive: true,
      isFollowed: false, // Ensure isFollowed is false for copied rules
    });
    await ruleState.save({ session });
  }
};

// Helper function to get effective rules for a specific date
const getEffectiveRulesForDate = async (userId, date, session = null) => {
  const utcDate = normalizeDate(date);

  // Check if rules exist for the requested date
  const rulesExist = await hasRulesForDate(userId, utcDate, session);

  // If rules exist for the date, return them
  if (rulesExist) {
    const currentDateStates = await RuleState.find({
      user: userId,
      date: utcDate,
    })
      .populate("rule")
      .session(session);

    return currentDateStates
      .filter((state) => state.rule && state.isActive)
      .map((state) => ({
        _id: state.rule._id,
        description: state.rule.description,
        isFollowed: state.isFollowed,
        createdAt: state.rule.createdAt,
      }));
  }

  // If no rules exist for the date, show master date rules (but don't save them)
  const masterRules = await getMasterRuleList(userId, session);
  
  return masterRules.map((rule) => ({
    _id: rule._id,
    description: rule.description,
    isFollowed: false, // Default to false for display
    createdAt: rule.createdAt,
  }));
};

exports.getRules = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const date = req.query.date || new Date();
    const utcDate = normalizeDate(date);
    const rules = await getEffectiveRulesForDate(req.user.id, utcDate, session);
    await session.commitTransaction();
    res.json(rules);
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ message: "Error fetching rules", error: error.message });
  } finally {
    session.endSession();
  }
};

exports.addRule = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Use the date from the request body, default to current date if not provided
    const utcDate = normalizeDate(req.body.date || new Date());
    
    // Check if this is the first rule being added (no master date exists)
    const currentMasterDate = await getOrSetMasterDate(req.user.id, session);
    
    // If no master date exists, set it to the provided date
    if (!currentMasterDate) {
      await getOrSetMasterDate(req.user.id, session, utcDate);
    }

    // Only copy master rules if we're adding to a different date than master date
    // and no rules exist for that date
    const rulesExist = await hasRulesForDate(req.user.id, utcDate, session);
    const isMasterDate = currentMasterDate && utcDate.getTime() === currentMasterDate.getTime();
    
    if (!rulesExist && currentMasterDate && !isMasterDate) {
      await copyMasterRulesToDate(req.user.id, utcDate, session);
    }

    // Create new rule with the provided date
    const newRule = new Rule({
      user: req.user.id,
      description: req.body.description,
      createdAt: utcDate, // Use the provided date
      authorityDate: isMasterDate ? utcDate : null, // Only set authorityDate if adding to current master date
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

    // Only update master date if the provided date is later than the current master date
    const finalMasterDate = await getOrSetMasterDate(req.user.id, session);
    if (finalMasterDate && utcDate > finalMasterDate) {
      await getOrSetMasterDate(req.user.id, session, utcDate, true);
    }

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
    // Use the provided date, default to current date if not provided
    const utcDate = normalizeDate(req.body.date || new Date());
    const rule = await Rule.findOne({ _id: req.params.id, user: req.user.id }).session(session);
    if (!rule) {
      throw new Error("Rule not found");
    }

    const currentMasterDate = await getOrSetMasterDate(req.user.id, session);
    const isMasterDate = currentMasterDate && utcDate.getTime() === currentMasterDate.getTime();

    // Only copy master rules if we're updating on a different date than master date
    // and no rules exist for that date
    const rulesExist = await hasRulesForDate(req.user.id, utcDate, session);
    if (!rulesExist && currentMasterDate && !isMasterDate) {
      await copyMasterRulesToDate(req.user.id, utcDate, session);
    }

    // Create a new rule for the specified date to ensure independence
    const newRule = new Rule({
      user: req.user.id,
      description: req.body.description,
      createdAt: utcDate, // Use the provided date
      authorityDate: null, // Edited rules should not be part of master list
    });
    await newRule.save({ session });

    // Update or create rule state for the new rule
    const ruleState = await RuleState.findOneAndUpdate(
      { user: req.user.id, rule: newRule._id, date: utcDate },
      { isActive: true, isFollowed: false },
      { upsert: true, new: true, session }
    );

    // Mark the old rule as inactive for this date
    await RuleState.findOneAndUpdate(
      { user: req.user.id, rule: req.params.id, date: utcDate },
      { isActive: false },
      { upsert: true, new: true, session }
    );

    // Only update master date if the provided date is later than the current master date
    const finalMasterDate = await getOrSetMasterDate(req.user.id, session);
    if (finalMasterDate && utcDate > finalMasterDate) {
      await getOrSetMasterDate(req.user.id, session, utcDate, true);
    }

    await session.commitTransaction();
    res.json({
      _id: newRule._id,
      description: newRule.description,
      isFollowed: ruleState.isFollowed,
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

    const currentMasterDate = await getOrSetMasterDate(req.user.id, session);
    const isMasterDate = currentMasterDate && utcDate.getTime() === currentMasterDate.getTime();

    // Only copy master rules if we're deleting on a different date than master date
    // and no rules exist for that date
    const rulesExist = await hasRulesForDate(req.user.id, utcDate, session);
    if (!rulesExist && currentMasterDate && !isMasterDate) {
      await copyMasterRulesToDate(req.user.id, utcDate, session);
    }

    // Mark the rule as inactive for the specified date
    await RuleState.findOneAndUpdate(
      { user: req.user.id, rule: req.params.id, date: utcDate },
      { isActive: false },
      { upsert: true, new: true, session }
    );

    // Only update master date if the provided date is later than the current master date
    const finalMasterDate = await getOrSetMasterDate(req.user.id, session);
    if (finalMasterDate && utcDate > finalMasterDate) {
      await getOrSetMasterDate(req.user.id, session, utcDate, true);
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

    const currentMasterDate = await getOrSetMasterDate(req.user.id, session);
    const isMasterDate = currentMasterDate && utcDate.getTime() === currentMasterDate.getTime();

    // Only copy master rules if we're following/unfollowing on a different date than master date
    // and no rules exist for that date
    const rulesExist = await hasRulesForDate(req.user.id, utcDate, session);
    if (!rulesExist && currentMasterDate && !isMasterDate) {
      await copyMasterRulesToDate(req.user.id, utcDate, session);
    }

    // Update or create rule state for the specified date
    const ruleState = await RuleState.findOneAndUpdate(
      { user: req.user.id, rule: ruleId, date: utcDate },
      { isActive: true, isFollowed },
      { upsert: true, new: true, session }
    );

    // Only update master date if the provided date is later than the current master date
    const finalMasterDate = await getOrSetMasterDate(req.user.id, session);
    if (finalMasterDate && utcDate > finalMasterDate) {
      await getOrSetMasterDate(req.user.id, session, utcDate, true);
    }

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
    
    const currentMasterDate = await getOrSetMasterDate(req.user.id, session);
    const isMasterDate = currentMasterDate && utcDate.getTime() === currentMasterDate.getTime();

    // Only copy master rules if we're following/unfollowing on a different date than master date
    // and no rules exist for that date
    const rulesExist = await hasRulesForDate(req.user.id, utcDate, session);
    if (!rulesExist && currentMasterDate && !isMasterDate) {
      await copyMasterRulesToDate(req.user.id, utcDate, session);
    }

    // Get the effective rules for this date
    const rules = await getEffectiveRulesForDate(req.user.id, utcDate, session);
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

    // Only update master date if the provided date is later than the current master date
    const finalMasterDate = await getOrSetMasterDate(req.user.id, session);
    if (finalMasterDate && utcDate > finalMasterDate) {
      await getOrSetMasterDate(req.user.id, session, utcDate, true);
    }

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
    
    // Set master date to the date sample rules are loaded (first time setup)
    await getOrSetMasterDate(req.user.id, session, utcDate);

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
        authorityDate: utcDate, // Sample rules are always part of master list
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
    const { rules } = req.body;

    if (!Array.isArray(rules) || rules.length === 0) {
      throw new Error("Rules must be a non-empty array of objects with description and date");
    }

    const newRules = [];
    let latestDate = null;

    // Process each rule with its own date
    for (const rule of rules) {
      if (!rule.description || typeof rule.description !== "string" || rule.description.trim() === "") {
        throw new Error("Each rule must have a valid non-empty description");
      }

      // Use the date from the rule, or fall back to current date
      const ruleDate = rule.date ? normalizeDate(rule.date) : normalizeDate(new Date());
      
      // Track the latest date for master date update
      if (!latestDate || ruleDate > latestDate) {
        latestDate = ruleDate;
      }

      // Check if rules exist for this date
      const rulesExist = await hasRulesForDate(req.user.id, ruleDate, session);
      const currentMasterDate = await getOrSetMasterDate(req.user.id, session);
      const isMasterDate = currentMasterDate && ruleDate.getTime() === currentMasterDate.getTime();

      // Copy master rules if needed
      if (!rulesExist && currentMasterDate && !isMasterDate) {
        await copyMasterRulesToDate(req.user.id, ruleDate, session);
      }

      // Create new rule with the rule's date
      const newRule = new Rule({
        user: req.user.id,
        description: rule.description.trim(),
        createdAt: ruleDate, // Use the rule's date
        authorityDate: isMasterDate ? ruleDate : null, // Only set authorityDate if adding to current master date
      });
      await newRule.save({ session });

      // Create rule state for the specified date
      const ruleState = new RuleState({
        user: req.user.id,
        rule: newRule._id,
        date: ruleDate,
        isActive: true,
        isFollowed: false,
      });
      await ruleState.save({ session });

      newRules.push({
        _id: newRule._id,
        description: newRule.description,
        isFollowed: false,
        createdAt: newRule.createdAt,
      });
    }

    // Only update master date if the latest rule date is later than the current master date
    const currentMasterDate = await getOrSetMasterDate(req.user.id, session);
    if (currentMasterDate && latestDate && latestDate > currentMasterDate) {
      await getOrSetMasterDate(req.user.id, session, latestDate, true);
    }

    // Update points based on the current date
    const pointsChange = await updateUserPointsForActionToday(req.user.id, new Date(), session);

    await session.commitTransaction();
    res.status(201).json(newRules);
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ message: "Error adding bulk rules", error: error.message });
  } finally {
    session.endSession();
  }
};