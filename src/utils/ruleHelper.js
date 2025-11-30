// utils/ruleHelper.js
const Rule = require("../models/Rule");
const RuleState = require("../models/RuleState");
const { normalizeDate } = require("./dateHelper");

// Returns the list of rules for a given date exactly as frontend expects
const getEffectiveRulesForDate = async (userId, dateInput, session = null) => {
  const targetDate = normalizeDate(dateInput);

  let states = await RuleState.find({
    user: userId,
    date: targetDate,
  })
    .populate("rule", "description createdAt")
    .sort({ "rule.createdAt": 1 })
    .session(session)
    .lean();

  if (states.length > 0) {
    return states.map(s => ({
      _id: s.rule._id,
      description: s.rule.description,
      isFollowed: s.isFollowed,
      createdAt: s.rule.createdAt,
    }));
  }

  // No states: find fallback date (prefer closest future, then previous)
  let fallbackDateDoc = await RuleState.findOne({
    user: userId,
    date: { $gt: targetDate },
  })
    .sort({ date: 1 })
    .select("date")
    .session(session);

  let fallbackDate = fallbackDateDoc ? fallbackDateDoc.date : null;

  if (!fallbackDate) {
    fallbackDateDoc = await RuleState.findOne({
      user: userId,
      date: { $lt: targetDate },
    })
      .sort({ date: -1 })
      .select("date")
      .session(session);
    fallbackDate = fallbackDateDoc ? fallbackDateDoc.date : null;
  }

  if (!fallbackDate) return [];

  const fallbackStates = await RuleState.find({
    user: userId,
    date: fallbackDate,
  })
    .populate("rule", "description createdAt")
    .sort({ "rule.createdAt": 1 })
    .session(session)
    .lean();

  return fallbackStates.map(s => ({
    _id: s.rule._id,
    description: s.rule.description,
    isFollowed: false, // Always false for fallback
    createdAt: s.rule.createdAt,
  }));
};

module.exports = { getEffectiveRulesForDate };