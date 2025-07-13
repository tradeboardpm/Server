const Trade = require("../models/Trade");
const User = require("../models/User");
const moment = require("moment");
const mongoose = require("mongoose");
const { updateUserPointsForActionToday } = require("../utils/pointsHelper");


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
    });

    const existingOpenTrades = await Trade.find({
      user: user._id,
      instrumentName: newTrade.instrumentName,
      equityType: newTrade.equityType,
      isOpen: true,
    }).session(session);

    let resultTrades = [];
    let capitalChange = 0;

    if (existingOpenTrades.length > 0) {
      let openBuyTrade = existingOpenTrades.find((trade) => trade.action === "buy");
      let openSellTrade = existingOpenTrades.find((trade) => trade.action === "sell");
      let currentTrade = newTrade;

      if (openBuyTrade && currentTrade.action === "buy") {
        const { mergedTrade } = mergeTrades(openBuyTrade, currentTrade);
        resultTrades.push(mergedTrade);
        capitalChange -= (currentTrade.quantity * currentTrade.buyingPrice +
          currentTrade.brokerage + currentTrade.exchangeRate);
        currentTrade = null;
      }

      if (openSellTrade && currentTrade && currentTrade.action === "sell") {
        const { mergedTrade } = mergeTrades(openSellTrade, currentTrade);
        resultTrades.push(mergedTrade);
        capitalChange += (currentTrade.quantity * currentTrade.sellingPrice -
          currentTrade.brokerage - currentTrade.exchangeRate);
        currentTrade = null;
      }

      if (currentTrade) {
        const oppositeOpenTrade = currentTrade.action === "buy" ? openSellTrade : openBuyTrade;
        if (oppositeOpenTrade) {
          const { mergedTrade, remainingTrade } = mergeTrades(oppositeOpenTrade, currentTrade);
          mergedTrade.date = newTrade.date;
          mergedTrade.isOpen = false;
          resultTrades.push(mergedTrade);

          if (currentTrade.action === "sell") {
            capitalChange += (currentTrade.quantity * currentTrade.sellingPrice -
              currentTrade.brokerage - currentTrade.exchangeRate);
          } else if (currentTrade.action === "buy") {
            capitalChange -= (currentTrade.quantity * currentTrade.buyingPrice +
              currentTrade.brokerage + currentTrade.exchangeRate);
          }

          if (remainingTrade) {
            resultTrades.push(remainingTrade);
            if (remainingTrade.action === "buy") {
              capitalChange -= (remainingTrade.quantity * remainingTrade.buyingPrice +
                remainingTrade.brokerage + remainingTrade.exchangeRate);
            } else if (remainingTrade.action === "sell") {
              capitalChange += (remainingTrade.quantity * remainingTrade.sellingPrice -
                remainingTrade.brokerage - remainingTrade.exchangeRate);
            }
          }
        } else {
          resultTrades.push(currentTrade);
          if (currentTrade.action === "buy") {
            capitalChange -= (currentTrade.quantity * currentTrade.buyingPrice +
              currentTrade.brokerage + currentTrade.exchangeRate);
          } else if (currentTrade.action === "sell") {
            capitalChange += (currentTrade.quantity * currentTrade.sellingPrice -
              currentTrade.brokerage - currentTrade.exchangeRate);
          }
        }
      }

      await Trade.deleteMany({
        _id: { $in: existingOpenTrades.map((trade) => trade._id) },
      }).session(session);
    } else {
      resultTrades.push(newTrade);
      if (newTrade.action === "buy") {
        capitalChange -= (newTrade.quantity * newTrade.buyingPrice +
          newTrade.brokerage + newTrade.exchangeRate);
      } else if (newTrade.action === "sell") {
        capitalChange += (newTrade.quantity * newTrade.sellingPrice -
          newTrade.brokerage - newTrade.exchangeRate);
      } else if (newTrade.action === "both") {
        capitalChange += newTrade.netPnl;
      }
    }

    for (let trade of resultTrades) {
      await trade.save({ session });
    }

    if (capitalChange !== 0) {
      await user.updateCapital(capitalChange, newTrade.date);
    }

    const pointsChange = await updateUserPointsForActionToday(req.user._id, new Date(), session);
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      trades: resultTrades,
      pointsChange,
      capitalChange,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error in addTrade:", error);
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

    // Store original values for capital adjustment
    const originalBuyingPrice = tradeToEdit.buyingPrice || 0;
    const originalSellingPrice = tradeToEdit.sellingPrice || 0;
    const originalBrokerage = tradeToEdit.brokerage || 0;
    const originalExchangeRate = tradeToEdit.exchangeRate || 0;
    const oldNetPnl = tradeToEdit.netPnl || 0;

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

        // If the merged trade remains open, calculate capital change based on price difference
        if (mergedTrade.isOpen) {
          if (mergedTrade.action === "buy") {
            const originalCost = originalBuyingPrice * tradeToEdit.quantity + originalBrokerage + originalExchangeRate;
            const newCost = mergedTrade.buyingPrice * mergedTrade.quantity + mergedTrade.brokerage + mergedTrade.exchangeRate;
            capitalChange += originalCost - newCost; // Reverse original, apply new
          } else if (mergedTrade.action === "sell") {
            const originalProceeds = originalSellingPrice * tradeToEdit.quantity - originalBrokerage - originalExchangeRate;
            const newProceeds = mergedTrade.sellingPrice * mergedTrade.quantity - mergedTrade.brokerage - mergedTrade.exchangeRate;
            capitalChange += newProceeds - originalProceeds; // Adjust based on new proceeds
          }
        } else if (mergedTrade.action === "both") {
          capitalChange += mergedTrade.netPnl; // Completed trade affects capital via netPnl
        }
      } else if (oppositeTrade) {
        // Even out with opposite open trade
        const { mergedTrade, remainingTrade } = mergeTrades(oppositeTrade, editedTrade);
        resultTrades.push(mergedTrade);
        if (remainingTrade) {
          resultTrades.push(remainingTrade);
          // Handle remaining open trade capital change
          if (remainingTrade.action === "buy") {
            capitalChange -= (remainingTrade.quantity * remainingTrade.buyingPrice +
              remainingTrade.brokerage + remainingTrade.exchangeRate);
          } else if (remainingTrade.action === "sell") {
            capitalChange += (remainingTrade.quantity * remainingTrade.sellingPrice -
              remainingTrade.brokerage - remainingTrade.exchangeRate);
          }
        }
        if (mergedTrade.action === "both") {
          capitalChange += mergedTrade.netPnl; // Completed trade
        }
      } else {
        // No matching open trades, keep the edited trade as is
        resultTrades.push(editedTrade);

        // Calculate capital change for the edited open trade
        if (editedTrade.isOpen) {
          if (editedTrade.action === "buy") {
            const originalCost = originalBuyingPrice * tradeToEdit.quantity + originalBrokerage + originalExchangeRate;
            const newCost = editedTrade.buyingPrice * editedTrade.quantity + editedTrade.brokerage + editedTrade.exchangeRate;
            capitalChange += originalCost - newCost; // Reverse original, apply new
          } else if (editedTrade.action === "sell") {
            const originalProceeds = originalSellingPrice * tradeToEdit.quantity - originalBrokerage - originalExchangeRate;
            const newProceeds = editedTrade.sellingPrice * editedTrade.quantity - editedTrade.brokerage - editedTrade.exchangeRate;
            capitalChange += newProceeds - originalProceeds; // Adjust based on new proceeds
          }
        } else if (editedTrade.action === "both") {
          capitalChange += editedTrade.netPnl; // Completed trade
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

      // Calculate capital change for the edited open trade
      if (editedTrade.isOpen) {
        if (editedTrade.action === "buy") {
          const originalCost = originalBuyingPrice * tradeToEdit.quantity + originalBrokerage + originalExchangeRate;
          const newCost = editedTrade.buyingPrice * editedTrade.quantity + editedTrade.brokerage + editedTrade.exchangeRate;
          capitalChange += originalCost - newCost; // Reverse original, apply new
        } else if (editedTrade.action === "sell") {
          const originalProceeds = originalSellingPrice * tradeToEdit.quantity - originalBrokerage - originalExchangeRate;
          const newProceeds = editedTrade.sellingPrice * editedTrade.quantity - editedTrade.brokerage - editedTrade.exchangeRate;
          capitalChange += newProceeds - originalProceeds; // Adjust based on new proceeds
        }
      } else if (editedTrade.action === "both") {
        capitalChange += editedTrade.netPnl; // Completed trade
      }

      await Trade.deleteOne({ _id: tradeToEdit._id }).session(session);
    }

    // Subtract the old netPnl if the original trade was complete (unlikely since it’s open, but for safety)
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
    res.status(200).json({
      trades: resultTrades,
      capitalChange, // Optionally return for frontend feedback
    });
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
    const trade = await Trade.findOne({ _id: req.params.id, user: req.user._id }).session(session);
    if (!trade) throw new Error("Trade not found");

    let capitalChange = 0;
    const tradeDate = moment.utc(trade.date).startOf("day").toDate();

    if (trade.isOpen) {
      if (trade.action === "buy") capitalChange += (trade.quantity * (trade.buyingPrice || 0) + (trade.brokerage || 0) + (trade.exchangeRate || 0));
      else if (trade.action === "sell") capitalChange -= (trade.quantity * (trade.sellingPrice || 0) - (trade.brokerage || 0) - (trade.exchangeRate || 0));
    } else if (trade.action === "both") capitalChange = -(trade.netPnl || 0);

    await Trade.deleteOne({ _id: req.params.id, user: req.user._id }).session(session);
    if (capitalChange !== 0) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(capitalChange, trade.date);
    }

    const pointsChange = await updateUserPointsForActionToday(req.user._id, tradeDate, session);

    await session.commitTransaction();
    session.endSession();
    res.status(200).json({
      message: "Trade deleted successfully",
      capitalUpdated: capitalChange !== 0,
      capitalChangeAmount: capitalChange,
      pointsChange,
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

    // Filter trades based on the following rules:
    // 1. Include trades created on the query date (open or completed)
    // 2. Include open trades from before the query date
    // 3. Exclude completed trades from before the query date
    const filteredTrades = trades.filter((trade) => {
      const tradeDate = moment.utc(trade.date).startOf("day");
      const isQueryDate = tradeDate.isSame(queryDate, "day");
      const isOpenTrade = trade.isOpen;
      const isBeforeQueryDate = tradeDate.isBefore(queryDate, "day");

      // Include trades on the query date (open or completed)
      if (isQueryDate) {
        return true;
      }

      // For past dates, include only open trades
      if (isBeforeQueryDate && isOpenTrade) {
        return true;
      }

      // Exclude completed trades from past dates
      return false;
    });

    // Check if there are any complete trades in the filtered results
    const hasCompleteTrade = filteredTrades.some((trade) => !trade.isOpen);

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

    // If there are no complete trades, return empty summary
    if (!hasCompleteTrade) {
      res.send({
        trades: filteredTrades,
        summary: emptySummary,
      });
      return;
    }

    // Compute detailed summary for closed trades
    const summary = filteredTrades.reduce(
      (acc, trade) => {
        // Skip open trades in the summary calculation
        if (trade.isOpen) {
          return acc;
        }

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