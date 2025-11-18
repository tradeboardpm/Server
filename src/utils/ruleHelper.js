// utils/ruleHelper.js
const Rule = require("../models/Rule");
const RuleState = require("../models/RuleState");
const { normalizeDate } = require("./dateHelper");

// Returns the list of rules for a given date exactly as frontend expects
const getEffectiveRulesForDate = async (userId, dateInput, session = null) => {
  const targetDate = normalizeDate(dateInput);

  // Get all user's rules (these are permanent)
  const rules = await Rule.find({ user: userId })
    .sort({ createdAt: 1 })
    .session(session)
    .lean();

  if (rules.length === 0) return [];

  // Get RuleStates for this date only
  const states = await RuleState.find({
    user: userId,
    date: targetDate,
  })
    .select("rule isFollowed")
    .session(session)
    .lean();

  const stateMap = new Map();
  states.forEach(s => stateMap.set(s.rule.toString(), s.isFollowed));

  // Merge: every rule appears, with isFollowed = false if not set
  return rules.map(rule => ({
    _id: rule._id,
    description: rule.description,
    createdAt: rule.createdAt,
    isFollowed: stateMap.has(rule._id.toString()) 
      ? stateMap.get(rule._id.toString()) 
      : false,
  }));
};

module.exports = { getEffectiveRulesForDate };