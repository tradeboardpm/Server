const Capital = require("../models/Capital");
const moment = require("moment");

exports.getCapital = async (req, res) => {
  try {
    const { date } = req.query;
    const queryDate = date ? moment(date).endOf("day").toDate() : new Date();

    const capital = await Capital.findOne({
      user: req.user._id,
      date: { $lte: queryDate },
    }).sort({ date: -1 });

    if (!capital) {
      return res.status(404).send({ error: "Capital not found" });
    }

    res.send(capital);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.updateCapital = async (req, res) => {
  try {
    const { amount } = req.body;
    const date = moment().endOf("day").toDate();

    let capital = await Capital.findOne({
      user: req.user._id,
      date: { $lte: date },
    }).sort({ date: -1 });

    if (capital) {
      // Create a new capital entry for today
      capital = new Capital({
        user: req.user._id,
        date,
        amount: amount,
      });
    } else {
      // If no capital entry exists, create an initial one
      capital = new Capital({
        user: req.user._id,
        date,
        amount: amount,
      });
    }

    await capital.save();
    res.send(capital);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.getCapitalHistory = async (req, res) => {
  try {
    const capitalHistory = await Capital.find({ user: req.user._id }).sort({
      date: 1,
    });
    res.send(capitalHistory);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};
