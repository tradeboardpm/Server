const Trade = require("../models/Trade");
const Capital = require("../models/Capital");
const {
  calculateCharges,
  calculateGrossPnL,
  calculateNetPnL,
  initializeChargeRates,
} = require("../utils/tradeCalculations");
const moment = require("moment");

async function updateCapital(userId, date, pnLChange) {
  const endOfDay = moment(date).endOf("day").toDate();

  try {
    // Find the most recent capital entry on or before the trade date
    let capital = await Capital.findOne({
      user: userId,
      date: { $lte: endOfDay },
    }).sort({ date: -1 });

    if (!capital) {
      // If no previous capital entry exists, create an initial one
      capital = new Capital({
        user: userId,
        date: moment(date).startOf("day").toDate(),
        amount: 100000, // Default initial capital
      });
    }

    // Create or update the capital entry for this specific date
    const updatedCapital = await Capital.findOneAndUpdate(
      { user: userId, date: endOfDay },
      {
        $set: { amount: capital.amount + pnLChange },
        $setOnInsert: { date: endOfDay },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    // Update all future capital entries
    await Capital.updateMany(
      { user: userId, date: { $gt: endOfDay } },
      { $inc: { amount: pnLChange } }
    );

    console.log("Capital updated:", updatedCapital);
  } catch (error) {
    console.error("Error updating capital:", error);
    throw error;
  }
}

exports.createTrade = async (req, res) => {
  try {
    await initializeChargeRates();

    const {
      date,
      time,
      instrumentName,
      equityType,
      quantity,
      buyingPrice,
      sellingPrice,
      exchangeRate,
      brokerage,
    } = req.body;
    const tradeDate = moment(date).startOf("day").toDate();

    const action = sellingPrice > 0 ? "sell" : "buy";

    let existingTrade = await Trade.findOne({
      user: req.user._id,
      date: tradeDate,
      instrumentName,
      equityType,
    });

    let newNetPnL = 0;

    if (existingTrade) {
      const oldNetPnL = existingTrade.netPnL;

      existingTrade.quantity += quantity;
      if (buyingPrice) {
        existingTrade.buyingPrice = existingTrade.buyingPrice
          ? (existingTrade.buyingPrice * existingTrade.quantity +
              buyingPrice * quantity) /
            (existingTrade.quantity + quantity)
          : buyingPrice;
      }
      if (sellingPrice) {
        existingTrade.sellingPrice = existingTrade.sellingPrice
          ? (existingTrade.sellingPrice * existingTrade.quantity +
              sellingPrice * quantity) /
            (existingTrade.quantity + quantity)
          : sellingPrice;
      }
      existingTrade.brokerage += brokerage;

      const charges = await calculateCharges({
        equityType,
        action: existingTrade.sellingPrice > 0 ? "sell" : "buy",
        price: existingTrade.sellingPrice || existingTrade.buyingPrice,
        quantity: existingTrade.quantity,
        brokerage: existingTrade.brokerage,
      });

      existingTrade.charges = charges;
      existingTrade.grossPnL = calculateGrossPnL({
        action: existingTrade.sellingPrice > 0 ? "sell" : "buy",
        buyingPrice: existingTrade.buyingPrice,
        sellingPrice: existingTrade.sellingPrice,
        quantity: existingTrade.quantity,
      });
      existingTrade.netPnL = calculateNetPnL({
        grossPnL: existingTrade.grossPnL,
        charges,
      });

      newNetPnL = existingTrade.netPnL - oldNetPnL;

      await existingTrade.save();
    } else {
      const charges = await calculateCharges({
        equityType,
        action,
        price: buyingPrice || sellingPrice,
        quantity,
        brokerage,
      });
      const grossPnL = calculateGrossPnL({
        action,
        buyingPrice,
        sellingPrice,
        quantity,
      });
      const netPnL = calculateNetPnL({ grossPnL, charges });

      const trade = new Trade({
        user: req.user._id,
        date: tradeDate,
        time,
        instrumentName,
        equityType,
        action,
        quantity,
        buyingPrice,
        sellingPrice,
        exchangeRate,
        brokerage,
        charges,
        grossPnL,
        netPnL,
      });

      await trade.save();
      newNetPnL = netPnL;
      existingTrade = trade;
    }

    try {
      await updateCapital(req.user._id, tradeDate, newNetPnL);
      res.status(201).send(existingTrade);
    } catch (capitalError) {
      console.error("Error updating capital:", capitalError);
      res.status(201).send({
        trade: existingTrade,
        warning:
          "Trade saved but there was an error updating the capital. Please check your capital balance.",
      });
    }
  } catch (error) {
    console.error("Error creating trade:", error);
    res.status(400).send({ error: error.message });
  }
};

exports.updateTrade = async (req, res) => {
  try {
    const trade = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!trade) {
      return res.status(404).send({ error: "Trade not found" });
    }

    const oldNetPnL = trade.netPnL;

    const updates = req.body;
    Object.keys(updates).forEach((update) => {
      trade[update] = updates[update];
    });

    const action = trade.sellingPrice > 0 ? "sell" : "buy";
    const charges = await calculateCharges({
      equityType: trade.equityType,
      action,
      price: trade.sellingPrice || trade.buyingPrice,
      quantity: trade.quantity,
      brokerage: trade.brokerage,
    });

    trade.charges = charges;
    trade.grossPnL = calculateGrossPnL({
      action,
      buyingPrice: trade.buyingPrice,
      sellingPrice: trade.sellingPrice,
      quantity: trade.quantity,
    });
    trade.netPnL = calculateNetPnL({ grossPnL: trade.grossPnL, charges });

    await trade.save();

    const pnLDifference = trade.netPnL - oldNetPnL;

    try {
      await updateCapital(req.user._id, trade.date, pnLDifference);
      res.send(trade);
    } catch (capitalError) {
      console.error("Error updating capital:", capitalError);
      res.send({
        trade: trade,
        warning:
          "Trade updated but there was an error updating the capital. Please check your capital balance.",
      });
    }
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.deleteTrade = async (req, res) => {
  try {
    const trade = await Trade.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!trade) {
      return res.status(404).send({ error: "Trade not found" });
    }

    try {
      await updateCapital(req.user._id, trade.date, -trade.netPnL);
      res.send({ message: "Trade deleted successfully", trade });
    } catch (capitalError) {
      console.error("Error updating capital:", capitalError);
      res.send({
        message:
          "Trade deleted but there was an error updating the capital. Please check your capital balance.",
        trade,
      });
    }
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.getTrades = async (req, res) => {
  try {
    const trades = await Trade.find({ user: req.user._id }).sort({ date: -1 });
    res.send(trades);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.getTradesByDate = async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).send({ error: "Date parameter is required" });
    }

    const startOfDay = moment(date).startOf("day").toDate();
    const endOfDay = moment(date).endOf("day").toDate();

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startOfDay, $lte: endOfDay },
    }).sort({ createdAt: 1 });

    res.send(trades);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};
