// controllers/ruleController.js
const Rule = require("../models/Rule");
const RuleFollowed = require("../models/RuleFollowed");

exports.getRules = async (req, res) => {
  try {
    const rules = await Rule.find({ user: req.user.id });
    const date = new Date(req.query.date);
    date.setUTCHours(0, 0, 0, 0);

    const rulesWithFollowStatus = await Promise.all(
      rules.map(async (rule) => {
        const ruleFollowed = await RuleFollowed.findOne({
          user: req.user.id,
          rule: rule._id,
          date: date,
        });

        return {
          _id: rule._id,
          description: rule.description,
          isFollowed: ruleFollowed ? ruleFollowed.isFollowed : false,
        };
      })
    );

    res.json(rulesWithFollowStatus);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching rules", error: error.message });
  }
};

exports.addRule = async (req, res) => {
  try {
    const newRule = new Rule({
      user: req.user.id,
      description: req.body.description,
    });
    await newRule.save();
    res.status(201).json(newRule);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error adding rule", error: error.message });
  }
};

exports.addBulkRules = async (req, res) => {
  try {
    const { rules } = req.body;

    if (!Array.isArray(rules) || rules.length === 0) {
      return res
        .status(400)
        .json({ message: "Invalid input. Expected an array of rules." });
    }

    const newRules = await Promise.all(
      rules.map((rule) =>
        new Rule({
          user: req.user.id,
          description: rule.description,
        }).save()
      )
    );

    res.status(201).json(newRules);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error adding bulk rules", error: error.message });
  }
};

exports.updateRule = async (req, res) => {
  try {
    const updatedRule = await Rule.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { description: req.body.description },
      { new: true }
    );
    if (!updatedRule) {
      return res.status(404).json({ message: "Rule not found" });
    }
    res.json(updatedRule);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating rule", error: error.message });
  }
};

exports.deleteRule = async (req, res) => {
  try {
    const deletedRule = await Rule.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });
    if (!deletedRule) {
      return res.status(404).json({ message: "Rule not found" });
    }
    await RuleFollowed.deleteMany({ rule: req.params.id });
    res.json({ message: "Rule deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting rule", error: error.message });
  }
};

exports.followUnfollowRule = async (req, res) => {
  try {
    const { ruleId, date, isFollowed } = req.body;
    const utcDate = new Date(date);
    utcDate.setUTCHours(0, 0, 0, 0);

    const ruleFollowed = await RuleFollowed.findOneAndUpdate(
      { user: req.user.id, rule: ruleId, date: utcDate },
      { isFollowed },
      { upsert: true, new: true }
    );
    res.json(ruleFollowed);
  } catch (error) {
    res.status(500).json({
      message: "Error following/unfollowing rule",
      error: error.message,
    });
  }
};

exports.followUnfollowAll = async (req, res) => {
  try {
    const { date, isFollowed } = req.body;
    const utcDate = new Date(date);
    utcDate.setUTCHours(0, 0, 0, 0);
    const rules = await Rule.find({ user: req.user.id });

    await Promise.all(
      rules.map((rule) =>
        RuleFollowed.findOneAndUpdate(
          { user: req.user.id, rule: rule._id, date: utcDate },
          { isFollowed },
          { upsert: true }
        )
      )
    );

    res.json({ message: "All rules updated successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating all rules", error: error.message });
  }
};


exports.loadSampleRules = async (req, res) => {
  try {
    const sampleRules = [
      "Always adhere to your predefined strategy and rules for each trade. Consistency is key to long-term success.",
      "Limit the risk per trade to a small, manageable percentage of your total trading capital (e.g., 1-2%).",
      "Protect your capital by setting stop-loss orders to automatically exit trades if they move against you.",
      "Continuously monitor market news, economic indicators, and other factors that may influence your trades.",
      "Prioritize high-quality trade setups and avoid trading out of boredom or impatience.",
      "Make rational decisions based on your strategy rather than being driven by fear or greed.",
      "Regularly evaluate your trade history to identify patterns, learn from mistakes, and improve your strategy.",
      "Consistently follow your rules without making impulsive deviations, even during challenging market conditions.",
      "Define achievable and measurable targets for your trading performance, focusing on steady progress.",
      "Stay flexible and adjust your strategies as market conditions evolve or new information becomes available."
    ];

    const newRules = await Promise.all(
      sampleRules.map((description) =>
        new Rule({ user: req.user.id, description }).save()
      )
    );

    res.status(201).json(newRules);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error loading sample rules", error: error.message });
  }
};
