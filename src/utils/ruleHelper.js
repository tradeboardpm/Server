const RuleState = require("../models/RuleState");
const Rule = require("../models/Rule");
const moment = require("moment-timezone"); // Add timezone support

// Normalize to IST local day start, then to UTC
const normalizeDate = (date) => {
  return moment.tz(date, "Asia/Kolkata").startOf("day").utc().toDate();
};

const getEffectiveRulesForDate = async (userId, date) => {
  const targetDate = normalizeDate(date);

  const exactStates = await RuleState.find({
    user: userId,
    date: targetDate,
  })
    .populate("rule", "description createdAt authorityDate")
    .lean();

  if (exactStates.length > 0) {
    return exactStates
      .filter(s => s.rule && s.isActive)
      .map(s => ({
        _id: s.rule._id,
        description: s.rule.description,
        isFollowed: s.isFollowed,
        createdAt: s.rule.createdAt,
      }));
  }

  const masterRules = await Rule.find({
    user: userId,
    authorityDate: { $ne: null },
  }).sort({ createdAt: 1 }).lean();

  return masterRules.map(r => ({
    _id: r._id,
    description: r.description,
    isFollowed: false,
    createdAt: r.createdAt,
  }));
};

module.exports = { getEffectiveRulesForDate, normalizeDate };