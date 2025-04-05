const RuleState = require("../models/RuleState");
const Rule = require("../models/Rule");
const { normalizeDate } = require("./pointsHelper");

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
          isFollowed: false,
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

module.exports = {
  getEffectiveRulesForDate
};