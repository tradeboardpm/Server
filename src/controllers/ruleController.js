const Rule = require("../models/Rule");
const Journal = require("../models/Journal");
const moment = require("moment");

exports.createRule = async (req, res) => {
  try {
    const rule = new Rule({
      ...req.body,
      user: req.user._id,
    });
    await rule.save();

    // Add the new rule to today's journal if it exists
    const today = moment().startOf("day");
    const todaysJournal = await Journal.findOne({
      user: req.user._id,
      date: today.toDate(),
    });

    if (todaysJournal) {
      todaysJournal.rulesUnfollowed.push({
        description: rule.description,
        originalId: rule._id,
      });
      await todaysJournal.save();
    }

    res.status(201).send(rule);
  } catch (error) {
    res.status(400).send(error);
  }
};

exports.getRules = async (req, res) => {
  try {
    const { date } = req.query;
    const queryDate = date
      ? moment(date).startOf("day")
      : moment().startOf("day");

    // Check if a journal exists for the given date
    const journal = await Journal.findOne({
      user: req.user._id,
      date: queryDate.toDate(),
    });

    if (journal) {
      // If journal exists, return rules from the journal
      const allRules = [...journal.rulesFollowed, ...journal.rulesUnfollowed];
      res.send(allRules);
    } else {
      // If no journal exists, return all rules from the Rule collection
      const rules = await Rule.find({ user: req.user._id });
      res.send(rules);
    }
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.updateRule = async (req, res) => {
  try {
    const rule = await Rule.findOne({ _id: req.params.id, user: req.user._id });

    if (!rule) {
      return res.status(404).send({ error: "Rule not found" });
    }

    const updates = Object.keys(req.body);
    const allowedUpdates = ["description"];
    const isValidOperation = updates.every((update) =>
      allowedUpdates.includes(update)
    );

    if (!isValidOperation) {
      return res.status(400).send({ error: "Invalid updates!" });
    }

    updates.forEach((update) => (rule[update] = req.body[update]));
    await rule.save();

    // Update the rule in today's journal if it exists
    const today = moment().startOf("day");
    const todaysJournal = await Journal.findOne({
      user: req.user._id,
      date: today.toDate(),
    });

    if (todaysJournal) {
      todaysJournal.rulesFollowed = todaysJournal.rulesFollowed.map((r) =>
        r.originalId.toString() === rule._id.toString()
          ? { ...r, description: rule.description }
          : r
      );
      todaysJournal.rulesUnfollowed = todaysJournal.rulesUnfollowed.map((r) =>
        r.originalId.toString() === rule._id.toString()
          ? { ...r, description: rule.description }
          : r
      );
      await todaysJournal.save();
    }

    res.send(rule);
  } catch (error) {
    res.status(400).send(error);
  }
};

exports.deleteRule = async (req, res) => {
  try {
    const rule = await Rule.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!rule) {
      return res.status(404).send({ error: "Rule not found" });
    }

    // Remove the rule from today's journal if it exists
    const today = moment().startOf("day");
    const todaysJournal = await Journal.findOne({
      user: req.user._id,
      date: today.toDate(),
    });

    if (todaysJournal) {
      todaysJournal.rulesFollowed = todaysJournal.rulesFollowed.filter(
        (r) => r.originalId.toString() !== rule._id.toString()
      );
      todaysJournal.rulesUnfollowed = todaysJournal.rulesUnfollowed.filter(
        (r) => r.originalId.toString() !== rule._id.toString()
      );
      await todaysJournal.save();
    }

    res.send(rule);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.loadSampleRules = async (req, res) => {
  try {
    const existingRules = await Rule.find({ user: req.user._id });

    if (existingRules.length > 0) {
      return res
        .status(400)
        .send({ error: "Rules already exist for this user" });
    }

const sampleRules = [
  { description: "Keep a trading journal and review it regularly" },
  { description: "Stick to your trading plan: Always follow your predefined strategy and rules for each trade" },
  { description: "Manage risk carefully: Limit the risk per trade to a small percentage of your trading capital" },
  { description: "Use stop-loss orders: Set stop-loss orders to automatically exit trades if they go against you" },
  { description: "Stay informed: Keep updated with market news and economic indicators" },
  { description: "Avoid overtrading: Focus on high-quality trades and avoid excessive trading" }
];


    const createdRules = await Rule.insertMany(
      sampleRules.map((rule) => ({ ...rule, user: req.user._id }))
    );

    // Add sample rules to today's journal if it exists
    const today = moment().startOf("day");
    const todaysJournal = await Journal.findOne({
      user: req.user._id,
      date: today.toDate(),
    });

    if (todaysJournal) {
      todaysJournal.rulesUnfollowed = todaysJournal.rulesUnfollowed.concat(
        createdRules.map((rule) => ({
          description: rule.description,
          originalId: rule._id,
        }))
      );
      await todaysJournal.save();
    }

    res.status(201).send(createdRules);
  } catch (error) {
    res.status(400).send(error);
  }
};

exports.followRuleNoJournal = async (req, res) => {
  try {
    const { ruleId, date } = req.body;
    const queryDate = moment.utc(date).startOf("day");

    // Find the rule
    const rule = await Rule.findOne({ _id: ruleId, user: req.user._id });
    if (!rule) {
      return res.status(404).send({ error: "Rule not found" });
    }

    // Get all rules for the user
    const allRules = await Rule.find({ user: req.user._id });

    // Create a new journal
    const newJournal = new Journal({
      user: req.user._id,
      date: queryDate.toDate(),
      rulesFollowed: [
        {
          description: rule.description,
          originalId: rule._id,
        },
      ],
      rulesUnfollowed: allRules
        .filter((r) => r._id.toString() !== ruleId)
        .map((r) => ({
          description: r.description,
          originalId: r._id,
        })),
    });

    await newJournal.save();

    res.status(201).send(newJournal);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
