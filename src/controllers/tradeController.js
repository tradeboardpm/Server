const Trade = require("../models/Trade");
const User = require("../models/User");
const moment = require("moment");
const mongoose = require("mongoose");


// Merge completed trades with similar characteristics
async function mergeCompletedTrades(trades, session) {
  const mergedTrades = [];
  const tradeMap = new Map();

  for (const trade of trades) {
    const key = `${trade.instrumentName}_${
      trade.equityType
    }_${trade.date.toISOString()}`;

    if (tradeMap.has(key)) {
      const existingTrade = tradeMap.get(key);
      const totalQuantity = existingTrade.quantity + trade.quantity;

      // Weighted average calculations
      existingTrade.buyingPrice =
        (existingTrade.buyingPrice * existingTrade.quantity +
          trade.buyingPrice * trade.quantity) /
        totalQuantity;

      existingTrade.sellingPrice =
        (existingTrade.sellingPrice * existingTrade.quantity +
          trade.sellingPrice * trade.quantity) /
        totalQuantity;

      existingTrade.exchangeRate =
        (existingTrade.exchangeRate * existingTrade.quantity +
          trade.exchangeRate * trade.quantity) /
        totalQuantity;

      existingTrade.quantity = totalQuantity;
      existingTrade.brokerage += trade.brokerage;

      // Recalculate PnL
      existingTrade.pnl = 
        (existingTrade.sellingPrice - existingTrade.buyingPrice) * existingTrade.quantity;
      existingTrade.netPnl = 
        existingTrade.pnl - existingTrade.exchangeRate - existingTrade.brokerage;

      // Update in database
      await Trade.findByIdAndUpdate(
        existingTrade._id,
        {
          quantity: existingTrade.quantity,
          buyingPrice: existingTrade.buyingPrice,
          sellingPrice: existingTrade.sellingPrice,
          exchangeRate: existingTrade.exchangeRate,
          brokerage: existingTrade.brokerage,
          pnl: existingTrade.pnl,
          netPnl: existingTrade.netPnl
        },
        { session }
      );
    } else {
      tradeMap.set(key, trade);
    }
  }

  // Remove duplicate trades
  for (const [key, trade] of tradeMap.entries()) {
    const similarTrades = await Trade.find({
      instrumentName: trade.instrumentName,
      equityType: trade.equityType,
      date: trade.date,
      isOpen: false,
      _id: { $ne: trade._id },
    }).session(session);

    for (const similarTrade of similarTrades) {
      await Trade.findByIdAndDelete(similarTrade._id).session(session);
    }

    mergedTrades.push(trade);
  }

  return mergedTrades;
}

exports.createTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Prepare trade data
    const tradeData = {
      user: req.user._id,
      date: moment.utc(req.body.date).startOf("day").toDate(),
      time: req.body.time,
      instrumentName: req.body.instrumentName,
      equityType: req.body.equityType,
      quantity: req.body.quantity,
      action: req.body.action,
      buyingPrice: req.body.action === "buy" ? req.body.buyingPrice : null,
      sellingPrice: req.body.action === "sell" ? req.body.sellingPrice : null,
      exchangeRate: req.body.exchangeRate,
      brokerage: req.body.brokerage,
    };

    // Find matching open trades with opposite action
    const matchingTrades = await Trade.find({
      user: req.user._id,
      instrumentName: tradeData.instrumentName,
      equityType: tradeData.equityType,
      isOpen: true,
      action: tradeData.action === "buy" ? "sell" : "buy",
    })
      .sort({ date: 1, createdAt: 1 })
      .session(session);

    let remainingQuantity = tradeData.quantity;
    const completedTrades = [];
    const openTrades = [];

    // Match and process existing open trades
    for (let matchTrade of matchingTrades) {
      if (remainingQuantity <= 0) break;

      // Determine matching quantity
      const matchQuantity = Math.min(matchTrade.quantity, remainingQuantity);
      remainingQuantity -= matchQuantity;

      // Determine buying and selling prices
      const buyingPrice =
        tradeData.action === "buy"
          ? tradeData.buyingPrice
          : matchTrade.buyingPrice;

      const sellingPrice =
        tradeData.action === "sell"
          ? tradeData.sellingPrice
          : matchTrade.sellingPrice;

      // Create completed trade
      const completedTrade = new Trade({
        user: req.user._id,
        date: tradeData.date,
        time: tradeData.time,
        instrumentName: tradeData.instrumentName,
        equityType: tradeData.equityType,
        action: "both",
        quantity: matchQuantity,
        buyingPrice: buyingPrice,
        sellingPrice: sellingPrice,
        exchangeRate: (tradeData.exchangeRate + matchTrade.exchangeRate) / 2,
        brokerage: tradeData.brokerage + matchTrade.brokerage,
        isOpen: false,
      });

      await completedTrade.save({ session });
      completedTrades.push(completedTrade);

      // Update matching trade
      matchTrade.quantity -= matchQuantity;
      if (matchTrade.quantity > 0) {
        await matchTrade.save({ session });
      } else {
        await Trade.findByIdAndDelete(matchTrade._id).session(session);
      }
    }

    // Create remaining trade if quantity is left
    if (remainingQuantity > 0) {
      const newTrade = new Trade({
        ...tradeData,
        quantity: remainingQuantity,
        isOpen: true,
      });

      await newTrade.save({ session });
      openTrades.push(newTrade);
    }

    // Merge similar completed trades
    const mergedCompletedTrades = await mergeCompletedTrades(
      completedTrades,
      session
    );

    // Update user capital
    const user = await User.findById(req.user._id).session(session);
    if (user) {
      const totalNetPnL = mergedCompletedTrades.reduce((sum, trade) => {
        return sum + trade.netPnl;
      }, 0);

      await user.updateCapital(totalNetPnL, tradeData.date);
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).send({
      completedTrades: mergedCompletedTrades,
      openTrades: openTrades,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("Error creating trade:", error);
    res.status(400).send({ error: error.message });
  }
};

exports.getTradesByDate = async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).send({ error: "Date parameter is required" });
    }

    const startOfDay = moment.utc(date).startOf("day").toDate();
    const endOfDay = moment.utc(date).endOf("day").toDate();

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startOfDay, $lte: endOfDay },
    }).sort({ createdAt: -1 });

    // Compute detailed summary
    const summary = trades.reduce(
      (acc, trade) => {
        // Calculate trade-level P&L
        const tradePnL =
          trade.action === "both"
            ? (trade.sellingPrice - trade.buyingPrice) * trade.quantity
            : 0;

        // Charges calculation
        const tradeCharges = trade.exchangeRate + trade.brokerage;
        const netTradePnL = tradePnL - tradeCharges;

        // Aggregate calculations
        acc.totalTrades++;
        acc.totalQuantity += trade.quantity;
        acc.totalPnL += tradePnL;
        acc.totalNetPnL += netTradePnL;
        acc.totalCharges += tradeCharges;

        // Track trades by equity type
        if (!acc.tradesByEquityType[trade.equityType]) {
          acc.tradesByEquityType[trade.equityType] = {
            count: 0,
            quantity: 0,
            pnL: 0,
            charges: 0,
            netPnL: 0,
          };
        }

        acc.tradesByEquityType[trade.equityType].count++;
        acc.tradesByEquityType[trade.equityType].quantity += trade.quantity;
        acc.tradesByEquityType[trade.equityType].pnL += tradePnL;
        acc.tradesByEquityType[trade.equityType].charges += tradeCharges;
        acc.tradesByEquityType[trade.equityType].netPnL += netTradePnL;

        return acc;
      },
      {
        totalTrades: 0,
        totalQuantity: 0,
        totalPnL: 0,
        totalNetPnL: 0,
        totalCharges: 0,
        tradesByEquityType: {},
      }
    );

    res.send({
      trades,
      summary: {
        ...summary,
        averagePnL:
          summary.totalTrades > 0 ? summary.totalPnL / summary.totalTrades : 0,
        averageNetPnL:
          summary.totalTrades > 0
            ? summary.totalNetPnL / summary.totalTrades
            : 0,
      },
    });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.updateOpenTrade = async (req, res) => {
  try {
    const existingTrade = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
      isOpen: true,
    });

    if (!existingTrade) {
      return res.status(404).send({ error: "Open trade not found" });
    }

    const updateData = {
      date: moment
        .utc(req.body.date || existingTrade.date)
        .startOf("day")
        .toDate(),
      time: req.body.time || existingTrade.time,
      instrumentName: req.body.instrumentName || existingTrade.instrumentName,
      equityType: req.body.equityType || existingTrade.equityType,
      quantity: req.body.quantity || existingTrade.quantity,
      action: req.body.action || existingTrade.action,
      buyingPrice: req.body.buyingPrice || existingTrade.buyingPrice,
      sellingPrice: req.body.sellingPrice || existingTrade.sellingPrice,
      exchangeRate: req.body.exchangeRate || existingTrade.exchangeRate,
      brokerage: req.body.brokerage || existingTrade.brokerage,
    };

    const updatedTrade = await Trade.findByIdAndUpdate(
      existingTrade._id,
      updateData,
      { new: true }
    );

    res.send({
      trade: updatedTrade,
      message: "Open trade updated successfully",
    });
  } catch (error) {
    console.error("Error updating open trade:", error);
    res.status(400).send({
      error: error.message || "An error occurred while updating the open trade",
    });
  }
};

exports.updateCompleteTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const existingTrade = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
      isOpen: false,
    }).session(session);

    if (!existingTrade) {
      return res.status(404).send({ error: "Completed trade not found" });
    }

    // Store the old netPnL for capital adjustment
    const oldNetPnL = existingTrade.netPnl;

    // Update trade data
    const updateData = {
      date: moment
        .utc(req.body.date || existingTrade.date)
        .startOf("day")
        .toDate(),
      time: req.body.time || existingTrade.time,
      instrumentName: req.body.instrumentName || existingTrade.instrumentName,
      equityType: req.body.equityType || existingTrade.equityType,
      quantity: req.body.quantity || existingTrade.quantity,
      buyingPrice: req.body.buyingPrice || existingTrade.buyingPrice,
      sellingPrice: req.body.sellingPrice || existingTrade.sellingPrice,
      exchangeRate: req.body.exchangeRate || existingTrade.exchangeRate,
      brokerage: req.body.brokerage || existingTrade.brokerage,
    };

    // Update the trade
    const updatedTrade = await Trade.findByIdAndUpdate(
      existingTrade._id,
      updateData,
      { new: true, session }
    );

    // Recalculate user capital
    const user = await User.findById(req.user._id).session(session);
    if (user) {
      // Difference between new and old netPnL
      const netPnLDifference = updatedTrade.netPnl - oldNetPnL;
      await user.updateCapital(netPnLDifference, updatedTrade.date);
    }

    await session.commitTransaction();
    session.endSession();

    res.send({
      trade: updatedTrade,
      message: "Completed trade updated successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("Error updating completed trade:", error);
    res.status(400).send({
      error:
        error.message || "An error occurred while updating the completed trade",
    });
  }
};

exports.deleteTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const trade = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).session(session);

    if (!trade) {
      return res.status(404).send({ error: "Trade not found" });
    }

    // Delete the trade
    await Trade.findByIdAndDelete(trade._id).session(session);

    // Update user capital if needed
    const user = await User.findById(req.user._id).session(session);
    if (user) {
      // Subtract the trade's netPnL from capital
      await user.updateCapital(-trade.netPnl, trade.date);
    }

    await session.commitTransaction();
    session.endSession();

    res.send({ message: "Trade deleted successfully" });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("Error deleting trade:", error);
    res
      .status(500)
      .send({ error: "An error occurred while deleting the trade" });
  }
};
