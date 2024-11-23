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
    let capital = await Capital.findOne({
      user: userId,
      date: { $lte: endOfDay },
    }).sort({ date: -1 });

    if (!capital) {
      capital = new Capital({
        user: userId,
        date: moment(date).startOf("day").toDate(),
        amount: 100000, // Default initial capital
      });
    }

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

    // Determine action and adjust quantity
    const action = buyingPrice ? "buy" : "sell";
    const adjustedQuantity = action === "buy" ? quantity : -quantity;

    let existingTrade = await Trade.findOne({
      user: req.user._id,
      date: tradeDate,
      instrumentName,
      equityType,
    });

    let newNetPnL = 0;

    if (existingTrade) {
      const oldNetPnL = existingTrade.netPnL;

      // Update quantity
      existingTrade.quantity += adjustedQuantity;

      // Update prices
      if (buyingPrice) {
        const totalBuyValue =
          (existingTrade.buyingPrice || 0) *
            Math.max(existingTrade.quantity, 0) +
          buyingPrice * quantity;
        existingTrade.buyingPrice =
          totalBuyValue / Math.max(existingTrade.quantity, 0);
      }
      if (sellingPrice) {
        const totalSellValue =
          (existingTrade.sellingPrice || 0) *
            Math.abs(Math.min(existingTrade.quantity, 0)) +
          sellingPrice * quantity;
        existingTrade.sellingPrice =
          totalSellValue / Math.abs(Math.min(existingTrade.quantity, 0));
      }

      existingTrade.brokerage += brokerage;

      // Recalculate charges and P&L
      const finalAction = existingTrade.quantity > 0 ? "buy" : "sell";
      const charges = await calculateCharges({
        equityType,
        action: finalAction,
        price:
          finalAction === "sell"
            ? existingTrade.sellingPrice
            : existingTrade.buyingPrice,
        quantity: Math.abs(existingTrade.quantity),
        brokerage: existingTrade.brokerage,
      });

      existingTrade.charges = charges;
      existingTrade.grossPnL = calculateGrossPnL({
        action: finalAction,
        buyingPrice: existingTrade.buyingPrice,
        sellingPrice: existingTrade.sellingPrice,
        quantity: Math.abs(existingTrade.quantity),
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
        quantity: Math.abs(adjustedQuantity),
        brokerage,
      });
      const grossPnL = calculateGrossPnL({
        action,
        buyingPrice,
        sellingPrice,
        quantity: Math.abs(adjustedQuantity),
      });
      const netPnL = calculateNetPnL({ grossPnL, charges });

      const trade = new Trade({
        user: req.user._id,
        date: tradeDate,
        time,
        instrumentName,
        equityType,
        action,
        quantity: adjustedQuantity,
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
    const oldQuantity = trade.quantity;

    const updates = req.body;
    Object.keys(updates).forEach((update) => {
      if (update === "quantity") {
        // Adjust quantity based on action
        trade[update] = updates.buyingPrice
          ? Math.abs(updates[update])
          : -Math.abs(updates[update]);
      } else {
        trade[update] = updates[update];
      }
    });

    const action = trade.quantity > 0 ? "buy" : "sell";
    const charges = await calculateCharges({
      equityType: trade.equityType,
      action,
      price: action === "sell" ? trade.sellingPrice : trade.buyingPrice,
      quantity: Math.abs(trade.quantity),
      brokerage: trade.brokerage,
    });

    trade.charges = charges;
    trade.grossPnL = calculateGrossPnL({
      action,
      buyingPrice: trade.buyingPrice,
      sellingPrice: trade.sellingPrice,
      quantity: Math.abs(trade.quantity),
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
