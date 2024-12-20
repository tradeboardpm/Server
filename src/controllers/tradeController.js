  const Trade = require("../models/Trade");
  const User = require("../models/User");
  const moment = require("moment");
  const mongoose = require("mongoose");

// Merge completed trades with similar characteristics
async function mergeCompletedTrades(trades, session) {
  const mergedTrades = [];
  const tradeMap = new Map();

  for (const trade of trades) {
    // Include buying and selling prices in the key to ensure we only merge identical trades
    const key = `${trade.instrumentName}_${trade.equityType}_${trade.buyingPrice}_${trade.sellingPrice}_${trade.date.toISOString()}`;

    if (tradeMap.has(key)) {
      const existingTrade = tradeMap.get(key);

      // For completed trades:
      // - If trade.action is "both", it's already a completed trade, so we add quantities
      // - We need to sum the actual completed quantities
      existingTrade.quantity += trade.quantity;
      existingTrade.brokerage += trade.brokerage;
      existingTrade.exchangeRate += trade.exchangeRate;

      // Recalculate PnL based on the total quantity
      existingTrade.pnl = (existingTrade.sellingPrice - existingTrade.buyingPrice) * existingTrade.quantity;
      existingTrade.netPnl = existingTrade.pnl - existingTrade.exchangeRate - existingTrade.brokerage;

      // Update in database
      await Trade.findByIdAndUpdate(
        existingTrade._id,
        {
          quantity: existingTrade.quantity,
          brokerage: existingTrade.brokerage,
          exchangeRate: existingTrade.exchangeRate,
          pnl: existingTrade.pnl,
          netPnl: existingTrade.netPnl,
        },
        { session }
      );
    } else {
      // Initialize new trade in map
      tradeMap.set(key, { ...trade.toObject() });
    }
  }

  // Merge similar trades from the database
  for (const [key, trade] of tradeMap.entries()) {
    const similarTrades = await Trade.find({
      instrumentName: trade.instrumentName,
      equityType: trade.equityType,
      buyingPrice: trade.buyingPrice,
      sellingPrice: trade.sellingPrice,
      date: trade.date,
      isOpen: false,
      _id: { $ne: trade._id },
    }).session(session);

    // Keep track of whether this trade has been merged
    let hasBeenMerged = false;

    for (const similarTrade of similarTrades) {
      if (!hasBeenMerged) {
        // Add quantities and costs only once
        trade.quantity += similarTrade.quantity;
        trade.brokerage += similarTrade.brokerage;
        trade.exchangeRate += similarTrade.exchangeRate;
        hasBeenMerged = true;
      }

      // Delete the similar trade as it's now merged
      await Trade.findByIdAndDelete(similarTrade._id).session(session);
    }

    // Recalculate PnL
    trade.pnl = (trade.sellingPrice - trade.buyingPrice) * trade.quantity;
    trade.netPnl = trade.pnl - trade.exchangeRate - trade.brokerage;

    // Update the merged trade in the database
    await Trade.findByIdAndUpdate(trade._id, trade, { session });
    mergedTrades.push(trade);
  }

  return mergedTrades;
}


// Function to merge open trades with similar characteristics
async function mergeOpenTrades(trades, session) {
  const mergedTrades = [];
  const tradeMap = new Map();

  for (const trade of trades) {
    const key = `${trade.instrumentName}_${trade.equityType}_${trade.action}_${trade.date.toISOString()}`;

    if (tradeMap.has(key)) {
      const existingTrade = tradeMap.get(key);

      // Add quantities and costs
      existingTrade.quantity += trade.quantity;
      existingTrade.brokerage += trade.brokerage;
      existingTrade.exchangeRate += trade.exchangeRate;

      // Update average prices
      if (trade.action === "buy") {
        existingTrade.buyingPrice = (
          (existingTrade.buyingPrice * (existingTrade.quantity - trade.quantity) +
            trade.buyingPrice * trade.quantity) /
          existingTrade.quantity
        ).toFixed(2);
      } else {
        existingTrade.sellingPrice = (
          (existingTrade.sellingPrice * (existingTrade.quantity - trade.quantity) +
            trade.sellingPrice * trade.quantity) /
          existingTrade.quantity
        ).toFixed(2);
      }

      // Update in database
      await Trade.findByIdAndUpdate(
        existingTrade._id,
        {
          quantity: existingTrade.quantity,
          brokerage: existingTrade.brokerage,
          exchangeRate: existingTrade.exchangeRate,
          buyingPrice: existingTrade.buyingPrice,
          sellingPrice: existingTrade.sellingPrice,
        },
        { session }
      );
    } else {
      tradeMap.set(key, { ...trade.toObject() });
    }
  }

  // Merge similar trades from the database
  for (const [key, trade] of tradeMap.entries()) {
    const similarTrades = await Trade.find({
      instrumentName: trade.instrumentName,
      equityType: trade.equityType,
      action: trade.action,
      date: trade.date,
      isOpen: true,
      _id: { $ne: trade._id },
    }).session(session);

    for (const similarTrade of similarTrades) {
      // Add quantities and costs
      trade.quantity += similarTrade.quantity;
      trade.brokerage += similarTrade.brokerage;
      trade.exchangeRate += similarTrade.exchangeRate;

      // Update average prices
      if (trade.action === "buy") {
        trade.buyingPrice = (
          (parseFloat(trade.buyingPrice) * (trade.quantity - similarTrade.quantity) +
            parseFloat(similarTrade.buyingPrice) * similarTrade.quantity) /
          trade.quantity
        ).toFixed(2);
      } else {
        trade.sellingPrice = (
          (parseFloat(trade.sellingPrice) * (trade.quantity - similarTrade.quantity) +
            parseFloat(similarTrade.sellingPrice) * similarTrade.quantity) /
          trade.quantity
        ).toFixed(2);
      }

      // Delete the similar trade as it's now merged
      await Trade.findByIdAndDelete(similarTrade._id).session(session);
    }

    // Update the merged trade in the database
    await Trade.findByIdAndUpdate(trade._id, trade, { session });
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

      const matchQuantity = Math.min(matchTrade.quantity, remainingQuantity);
      remainingQuantity -= matchQuantity;

      const buyingPrice =
        tradeData.action === "buy"
          ? tradeData.buyingPrice
          : matchTrade.buyingPrice;
      const sellingPrice =
        tradeData.action === "sell"
          ? tradeData.sellingPrice
          : matchTrade.sellingPrice;

      // Create completed trade with matched quantity
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
        exchangeRate: tradeData.exchangeRate + matchTrade.exchangeRate,
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

    // Merge similar open trades
    const mergedOpenTrades = await mergeOpenTrades([...openTrades], session);

    // Merge similar completed trades
    const mergedCompletedTrades = await mergeCompletedTrades(
      [
        ...completedTrades,
        ...(await Trade.find({
          user: req.user._id,
          instrumentName: tradeData.instrumentName,
          equityType: tradeData.equityType,
          date: tradeData.date,
          isOpen: false,
        }).session(session)),
      ],
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
      openTrades: mergedOpenTrades,
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
