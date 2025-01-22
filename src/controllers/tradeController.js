const Trade = require("../models/Trade");
const User = require("../models/User");
const moment = require("moment");
const mongoose = require("mongoose");

// Helper function to merge trades
const mergeTrades = (existingTrade, newTrade) => {
  const mergedTrade = new Trade({
    ...existingTrade.toObject(),
    _id: new mongoose.Types.ObjectId(),
  });

  const totalQuantity = existingTrade.quantity + newTrade.quantity;
  mergedTrade.quantity = totalQuantity;

  if (existingTrade.action === newTrade.action) {
    // Merging two open trades of the same action
    if (existingTrade.action === "buy") {
      mergedTrade.buyingPrice =
        (existingTrade.buyingPrice * existingTrade.quantity +
          newTrade.buyingPrice * newTrade.quantity) /
        totalQuantity;
    } else {
      mergedTrade.sellingPrice =
        (existingTrade.sellingPrice * existingTrade.quantity +
          newTrade.sellingPrice * newTrade.quantity) /
        totalQuantity;
    }
    mergedTrade.action = existingTrade.action;
    mergedTrade.isOpen = true;
  } else if (existingTrade.action === "both" && newTrade.action === "both") {
    // Merging two complete trades
    mergedTrade.isOpen = false;
    const minQuantity = Math.min(existingTrade.quantity, newTrade.quantity);
    mergedTrade.quantity = minQuantity;
    mergedTrade.buyingPrice =
      existingTrade.action === "buy"
        ? existingTrade.buyingPrice
        : newTrade.buyingPrice;
    mergedTrade.sellingPrice =
      existingTrade.action === "sell"
        ? existingTrade.sellingPrice
        : newTrade.sellingPrice;
    mergedTrade.action = "both";
    mergedTrade.isOpen = false;
  } else {
    // Evening out trades
    const minQuantity = Math.min(existingTrade.quantity, newTrade.quantity);
    mergedTrade.quantity = minQuantity;
    mergedTrade.buyingPrice =
      existingTrade.action === "buy"
        ? existingTrade.buyingPrice
        : newTrade.buyingPrice;
    mergedTrade.sellingPrice =
      existingTrade.action === "sell"
        ? existingTrade.sellingPrice
        : newTrade.sellingPrice;
    mergedTrade.action = "both";
    mergedTrade.isOpen = false;
  }

  mergedTrade.brokerage =
    (existingTrade.brokerage || 0) + (newTrade.brokerage || 0);
  mergedTrade.exchangeRate =
    (existingTrade.exchangeRate || 0) + (newTrade.exchangeRate || 0);

  if (
    mergedTrade.action === "both" &&
    mergedTrade.buyingPrice &&
    mergedTrade.sellingPrice
  ) {
    mergedTrade.pnl =
      (mergedTrade.sellingPrice - mergedTrade.buyingPrice) *
      mergedTrade.quantity;
    mergedTrade.netPnl =
      mergedTrade.pnl - (mergedTrade.brokerage + mergedTrade.exchangeRate);
  } else {
    mergedTrade.pnl = 0;
    mergedTrade.netPnl = 0;
  }

  const remainingQuantity = Math.abs(
    existingTrade.quantity - newTrade.quantity
  );
  let remainingTrade = null;
  if (remainingQuantity > 0 && mergedTrade.action === "both") {
    const remainingAction =
      existingTrade.quantity > newTrade.quantity
        ? existingTrade.action
        : newTrade.action;
    remainingTrade = new Trade({
      ...(existingTrade.quantity > newTrade.quantity
        ? existingTrade.toObject()
        : newTrade.toObject()),
      _id: new mongoose.Types.ObjectId(),
      quantity: remainingQuantity,
      action: remainingAction,
      isOpen: true,
      pnl: 0,
      netPnl: 0,
    });
  }

  return { mergedTrade, remainingTrade };
};

exports.addTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(req.user._id).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "User not found" });
    }

    const newTrade = new Trade({
      ...req.body,
      user: user._id,
      date: moment.utc(req.body.date, "YYYY-MM-DD").toDate(),
      // brokerage: user.brokerage,
    });

    // Find existing open trades with the same instrument name and equity type
    const existingOpenTrades = await Trade.find({
      user: user._id,
      instrumentName: newTrade.instrumentName,
      equityType: newTrade.equityType,
      isOpen: true,
    }).session(session);

    let resultTrades = [];
    let capitalChange = 0;

    if (existingOpenTrades.length > 0) {
      let openBuyTrade = existingOpenTrades.find(
        (trade) => trade.action === "buy"
      );
      let openSellTrade = existingOpenTrades.find(
        (trade) => trade.action === "sell"
      );
      let currentTrade = newTrade;

      // Merge with open buy trade if exists and new trade is buy
      if (openBuyTrade && currentTrade.action === "buy") {
        const { mergedTrade } = mergeTrades(openBuyTrade, currentTrade);
        resultTrades.push(mergedTrade);
        currentTrade = null;
      }

      // Merge with open sell trade if exists and new trade is sell
      if (openSellTrade && currentTrade && currentTrade.action === "sell") {
        const { mergedTrade } = mergeTrades(openSellTrade, currentTrade);
        resultTrades.push(mergedTrade);
        currentTrade = null;
      }

      // If current trade still exists, try to even out with opposite open trade
      if (currentTrade) {
        const oppositeOpenTrade =
          currentTrade.action === "buy" ? openSellTrade : openBuyTrade;
        if (oppositeOpenTrade) {
          const { mergedTrade, remainingTrade } = mergeTrades(
            oppositeOpenTrade,
            currentTrade
          );
          mergedTrade.date = newTrade.date; // Set the date to the new trade's date
          mergedTrade.isOpen = false; // Close the trade
          resultTrades.push(mergedTrade);
          capitalChange += mergedTrade.netPnl;
          if (remainingTrade) {
            resultTrades.push(remainingTrade);
          }
        } else {
          resultTrades.push(currentTrade);
        }
      }

      // Delete the original open trades that were merged
      const tradesToDelete = existingOpenTrades.filter(
        (trade) =>
          !resultTrades.some((resultTrade) => resultTrade._id.equals(trade._id))
      );
      await Trade.deleteMany({
        _id: { $in: tradesToDelete.map((trade) => trade._id) },
      }).session(session);
    } else {
      resultTrades.push(newTrade);
    }

    // Save result trades
    for (let trade of resultTrades) {
      await trade.save({ session });
    }

    // Update user's capital for completed trades
    if (capitalChange !== 0) {
      await user.updateCapital(capitalChange, newTrade.date);
    }

    await session.commitTransaction();
    session.endSession();
    res.status(201).json(resultTrades);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ message: error.message });
  }
};

exports.editOpenTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const tradeToEdit = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
      isOpen: true,
    }).session(session);

    if (!tradeToEdit) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Open trade not found" });
    }

    // Store the original netPnl in case it was a complete trade that gets reopened
    const oldNetPnl = tradeToEdit.netPnl;

    // Apply the edits to a new object
    const editedTrade = new Trade({
      ...tradeToEdit.toObject(),
      ...req.body,
      _id: new mongoose.Types.ObjectId(),
    });

    // Find existing trades with the same date, name, and equity type
    const existingTrades = await Trade.find({
      user: req.user._id,
      date: editedTrade.date,
      instrumentName: editedTrade.instrumentName,
      equityType: editedTrade.equityType,
      _id: { $ne: tradeToEdit._id }, // Exclude the trade being edited
    }).session(session);

    let resultTrades = [];
    let capitalChange = 0;

    if (existingTrades.length > 0) {
      let openTrade = existingTrades.find(
        (trade) => trade.isOpen && trade.action === editedTrade.action
      );
      let oppositeTrade = existingTrades.find(
        (trade) => trade.isOpen && trade.action !== editedTrade.action
      );

      if (openTrade) {
        // Merge with existing open trade of the same action
        const { mergedTrade } = mergeTrades(openTrade, editedTrade);
        resultTrades.push(mergedTrade);

        // If the merged trade becomes complete, add its netPnl to capital change
        if (mergedTrade.action === "both") {
          capitalChange += mergedTrade.netPnl;
        }
      } else if (oppositeTrade) {
        // Even out with opposite open trade
        const { mergedTrade, remainingTrade } = mergeTrades(
          oppositeTrade,
          editedTrade
        );
        resultTrades.push(mergedTrade);
        if (remainingTrade) {
          resultTrades.push(remainingTrade);
        }
        if (mergedTrade.action === "both") {
          capitalChange += mergedTrade.netPnl;
        }
      } else {
        // No matching open trades, keep the edited trade as is
        resultTrades.push(editedTrade);

        // If the edited trade becomes complete, add its netPnl to capital change
        if (editedTrade.action === "both") {
          capitalChange += editedTrade.netPnl;
        }
      }

      // Subtract any previous netPnl if trades being merged were complete
      capitalChange -= existingTrades
        .filter((trade) => trade.action === "both")
        .reduce((sum, trade) => sum + trade.netPnl, 0);

      // Delete the original trade and any trades that were merged
      await Trade.deleteMany({
        _id: {
          $in: [tradeToEdit._id, ...existingTrades.map((trade) => trade._id)],
        },
      }).session(session);
    } else {
      // No existing trades to merge with, just update the original trade
      resultTrades.push(editedTrade);

      // If the edited trade becomes complete, add its netPnl to capital change
      if (editedTrade.action === "both") {
        capitalChange += editedTrade.netPnl;
      }
      await Trade.deleteOne({ _id: tradeToEdit._id }).session(session);
    }

    // Subtract the old netPnl if the original trade was complete
    if (tradeToEdit.action === "both") {
      capitalChange -= oldNetPnl;
    }

    // Save result trades
    for (let trade of resultTrades) {
      await trade.save({ session });
    }

    // Update user's capital if there was a change
    if (capitalChange !== 0) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(capitalChange, editedTrade.date);
    }

    await session.commitTransaction();
    session.endSession();
    res.status(200).json(resultTrades);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ message: error.message });
  }
};

exports.editCompleteTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const tradeToEdit = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
      action: "both",
    }).session(session);

    if (!tradeToEdit) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Complete trade not found" });
    }

    // Store the original netPnl
    const oldNetPnl = tradeToEdit.netPnl;

    // Apply the edits to a new object
    const editedTrade = new Trade({
      ...tradeToEdit.toObject(),
      ...req.body,
      _id: new mongoose.Types.ObjectId(),
    });

    // Recalculate PnL and netPnL for the edited trade
    if (editedTrade.action === "both") {
      editedTrade.pnl =
        (editedTrade.sellingPrice - editedTrade.buyingPrice) *
        editedTrade.quantity;
      editedTrade.netPnl =
        editedTrade.pnl - (editedTrade.brokerage + editedTrade.exchangeRate);
    }

    // Find existing complete trades with the same date, name, and equity type
    const existingCompleteTrades = await Trade.find({
      user: req.user._id,
      date: editedTrade.date,
      instrumentName: editedTrade.instrumentName,
      equityType: editedTrade.equityType,
      action: "both",
      _id: { $ne: tradeToEdit._id }, // Exclude the trade being edited
    }).session(session);

    let resultTrade = editedTrade;
    let capitalChange = 0;

    if (existingCompleteTrades.length > 0) {
      // Merge with existing complete trades
      for (let existingTrade of existingCompleteTrades) {
        const { mergedTrade } = mergeTrades(resultTrade, existingTrade);
        resultTrade = mergedTrade;
      }
      resultTrade.isOpen = false; // Ensure the merged complete trade is closed

      // Calculate capital change considering all affected trades
      const oldTotalNetPnl =
        oldNetPnl +
        existingCompleteTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
      capitalChange = resultTrade.netPnl - oldTotalNetPnl;

      // Delete the original trade and existing trades that were merged
      await Trade.deleteMany({
        _id: {
          $in: [
            tradeToEdit._id,
            ...existingCompleteTrades.map((trade) => trade._id),
          ],
        },
      }).session(session);
    } else {
      // No existing trades to merge with
      capitalChange = resultTrade.netPnl - oldNetPnl;
      await Trade.deleteOne({ _id: tradeToEdit._id }).session(session);
    }

    // Save the result trade
    await resultTrade.save({ session });

    // Update user's capital
    if (capitalChange !== 0) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(capitalChange, resultTrade.date);
    }

    await session.commitTransaction();
    session.endSession();
    res.status(200).json(resultTrade);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ message: error.message });
  }
};

exports.deleteTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // First find the trade to get its details before deletion
    const trade = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).session(session);

    if (!trade) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Trade not found" });
    }

    // Store the netPnl before deleting
    const netPnl = trade.netPnl || 0;

    // Delete the trade
    await Trade.deleteOne({
      _id: req.params.id,
      user: req.user._id,
    }).session(session);

    // If it was a complete trade (action: "both"), update user's capital
    if (trade.action === "both") {
      const user = await User.findById(req.user._id).session(session);
      // Subtract the netPnl since we're removing the trade
      await user.updateCapital(-netPnl, trade.date);
    }

    await session.commitTransaction();
    session.endSession();
    res.status(200).json({
      message: "Trade deleted successfully",
      capitalUpdated: trade.action === "both",
      capitalChangeAmount: trade.action === "both" ? -netPnl : 0,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ message: error.message });
  }
};

exports.getUserTrades = async (req, res) => {
  try {
    const trades = await Trade.find({ user: req.user._id }).sort({ date: -1 });
    res.status(200).json(trades);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.getTradesByDate = async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).send({ error: "Date parameter is required" });
    }

    const queryDate = moment.utc(date).startOf("day").toDate();

    // Find all trades up to and including the query date
    const trades = await Trade.find({
      user: req.user._id,
      date: { $lte: queryDate },
    }).sort({ date: -1, createdAt: -1 });

    // Filter trades to include:
    // 1. Trades created on the query date
    // 2. Open trades created before the query date
    // 3. Trades completed on the query date
    const filteredTrades = trades.filter((trade) => {
      const tradeDate = moment.utc(trade.date).startOf("day");
      const isQueryDate = tradeDate.isSame(queryDate, "day");
      const isOpenTrade = trade.isOpen;
      const isCompletedOnQueryDate =
        !trade.isOpen &&
        moment.utc(trade.updatedAt).startOf("day").isSame(queryDate, "day");

      return isQueryDate || isOpenTrade || isCompletedOnQueryDate;
    });

    // Check if any trade is open
    const hasOpenTrade = filteredTrades.some((trade) => trade.isOpen);

    // Initialize empty summary
    const emptySummary = {
      totalTrades: 0,
      totalQuantity: 0,
      totalPnL: 0,
      totalNetPnL: 0,
      totalCharges: 0,
      averagePnL: 0,
      averageNetPnL: 0,
      tradesByEquityType: {},
    };

    // If there's an open trade, return empty summary
    if (hasOpenTrade) {
      res.send({
        trades: filteredTrades,
        summary: emptySummary,
      });
      return;
    }

    // Compute detailed summary for closed trades
    const summary = filteredTrades.reduce(
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
      trades: filteredTrades,
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