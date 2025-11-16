// controllers/tradeController.js   (fixed – now behaves like the old version)
const mongoose = require("mongoose");
const Trade = require("../models/Trade");
const User = require("../models/User");
const moment = require("moment");
const { updateUserPointsForToday } = require("../utils/pointsHelper");
const { mergeTrades } = require("../utils/tradeHelper");

// ---------------------------------------------------------------------
// GET TRADES BY DATE (unchanged – already correct)
// ---------------------------------------------------------------------
exports.getTradesByDate = async (req, res) => {
  try {
    const { date } = req.query;
    const startOfDay = moment.utc(date).startOf("day").toDate();
    const endOfDay = moment.utc(date).endOf("day").toDate();

    const trades = await Trade.find({
      user: req.user._id,
      date: { $gte: startOfDay, $lte: endOfDay },
    })
      .select({
        date: 1,
        time: 1,
        instrumentName: 1,
        equityType: 1,
        action: 1,
        quantity: 1,
        buyingPrice: 1,
        sellingPrice: 1,
        exchangeRate: 1,
        brokerage: 1,
        isOpen: 1,
        netPnl: 1,
      })
      .sort({ time: 1 });

    let totalPnL = 0;
    let totalCharges = 0;
    let netPnL = 0;

    const completedTrades = trades.filter((t) => t.action === "both");
    const allOpen = trades.every((t) => t.isOpen);

    if (!allOpen && completedTrades.length > 0) {
      completedTrades.forEach((t) => {
        const grossPnL = t.netPnl + t.exchangeRate + t.brokerage;
        const charges = t.exchangeRate + t.brokerage;

        totalPnL += grossPnL;
        totalCharges += charges;
        netPnL += t.netPnl;

        t.grossPnL = Number(grossPnL.toFixed(2));
        t.charges = { totalCharges: Number(charges.toFixed(2)) };
        t.netPnL = Number(t.netPnl.toFixed(2));
      });
    }

    res.status(200).json({
      trades,
      summary: {
        totalTrades: trades.length,
        totalPnL: Number(totalPnL.toFixed(2)),
        totalCharges: Number(totalCharges.toFixed(2)),
        netPnL: Number(netPnL.toFixed(2)),
      },
    });
  } catch (error) {
    console.error("Error in getTradesByDate:", error);
    res.status(500).json({ error: error.message });
  }
};

// ---------------------------------------------------------------------
// ADD NEW TRADE – now merges with existing open trades (same as old code)
// ---------------------------------------------------------------------
exports.addTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      date,
      time,
      instrumentName,
      equityType,
      action,
      quantity,
      buyingPrice,
      sellingPrice,
      exchangeRate,
      brokerage,
    } = req.body;

    const tradeDate = moment.utc(date).startOf("day").toDate();

    const newTrade = new Trade({
      user: req.user._id,
      date: tradeDate,
      time: moment.utc(time).format("HH:mm:ss"),
      instrumentName,
      equityType,
      action,
      quantity: Number(quantity),
      buyingPrice: action !== "sell" ? Number(buyingPrice) : undefined,
      sellingPrice: action !== "buy" ? Number(sellingPrice) : undefined,
      exchangeRate: Number(exchangeRate) || 0,
      brokerage: Number(brokerage) || 0,
      isOpen: action !== "both",
    });

    // ---- 1. Find *all* open trades for the same instrument/equity on the same day ----
    const existingOpen = await Trade.find({
      user: req.user._id,
      date: tradeDate,
      instrumentName,
      equityType,
      isOpen: true,
    }).session(session);

    let resultTrades = [];
    let capitalChange = 0;
    let current = newTrade;

    if (existingOpen.length) {
      const openBuy = existingOpen.find((t) => t.action === "buy");
      const openSell = existingOpen.find((t) => t.action === "sell");

      // ---- SAME ACTION MERGE (buy + buy  OR  sell + sell) ----
      if (openBuy && current.action === "buy") {
        const { mergedTrade } = mergeTrades(openBuy, current);
        resultTrades.push(mergedTrade);
        capitalChange -=
          current.quantity * current.buyingPrice +
          current.brokerage +
          current.exchangeRate;
        current = null;
      }
      if (openSell && current && current.action === "sell") {
        const { mergedTrade } = mergeTrades(openSell, current);
        resultTrades.push(mergedTrade);
        capitalChange +=
          current.quantity * current.sellingPrice -
          current.brokerage -
          current.exchangeRate;
        current = null;
      }

      // ---- OPPOSITE ACTION MERGE (buy + sell) ----
      if (current) {
        const opposite = current.action === "buy" ? openSell : openBuy;
        if (opposite) {
          const { mergedTrade, remainingTrade } = mergeTrades(opposite, current);
          mergedTrade.date = tradeDate; // keep the day of the new entry
          resultTrades.push(mergedTrade);

          // capital for the part that got closed
          if (current.action === "sell") {
            capitalChange +=
              current.quantity * current.sellingPrice -
              current.brokerage -
              current.exchangeRate;
          } else {
            capitalChange -=
              current.quantity * current.buyingPrice +
              current.brokerage +
              current.exchangeRate;
          }

          if (remainingTrade) {
            resultTrades.push(remainingTrade);
            if (remainingTrade.action === "buy") {
              capitalChange -=
                remainingTrade.quantity * remainingTrade.buyingPrice +
                remainingTrade.brokerage +
                remainingTrade.exchangeRate;
            } else {
              capitalChange +=
                remainingTrade.quantity * remainingTrade.sellingPrice -
                remainingTrade.brokerage -
                remainingTrade.exchangeRate;
            }
          }
        } else {
          // no opposite → just add the new open trade
          resultTrades.push(current);
          if (current.action === "buy") {
            capitalChange -=
              current.quantity * current.buyingPrice +
              current.brokerage +
              current.exchangeRate;
          } else {
            capitalChange +=
              current.quantity * current.sellingPrice -
              current.brokerage -
              current.exchangeRate;
          }
        }
      }

      // delete everything that participated in the merge
      await Trade.deleteMany({
        _id: { $in: existingOpen.map((t) => t._id) },
      }).session(session);
    } else {
      // ---- NO OPEN TRADES → just insert the new one ----
      resultTrades.push(newTrade);
      if (newTrade.action === "buy") {
        capitalChange -=
          newTrade.quantity * newTrade.buyingPrice +
          newTrade.brokerage +
          newTrade.exchangeRate;
      } else if (newTrade.action === "sell") {
        capitalChange +=
          newTrade.quantity * newTrade.sellingPrice -
          newTrade.brokerage -
          newTrade.exchangeRate;
      } else if (newTrade.action === "both") {
        // direct complete trade
        newTrade.isOpen = false;
        newTrade.pnl =
          (newTrade.sellingPrice - newTrade.buyingPrice) * newTrade.quantity;
        newTrade.netPnl =
          newTrade.pnl - newTrade.brokerage - newTrade.exchangeRate;
        capitalChange = newTrade.netPnl;
      }
    }

    // ---- SAVE ALL RESULTING TRADES ----
    for (const t of resultTrades) await t.save({ session });

    // ---- UPDATE USER CAPITAL ----
    if (capitalChange !== 0) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(capitalChange, tradeDate);
    }

    const pointsChange = await updateUserPointsForToday(req.user._id, session);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      trades: resultTrades,
      capitalChange,
      pointsChange,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("addTrade error:", err);
    res.status(400).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// EDIT OPEN TRADE – merges with other open trades (old behaviour)
// ---------------------------------------------------------------------
exports.editOpenTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const {
      date,
      time,
      instrumentName,
      equityType,
      quantity,
      buyingPrice,
      exchangeRate,
      brokerage,
    } = req.body;

    const original = await Trade.findOne({
      _id: id,
      user: req.user._id,
      isOpen: true,
    }).session(session);
    if (!original) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "Open trade not found" });
    }

    const tradeDate = moment.utc(date || original.date).startOf("day").toDate();

    // ----- build edited version (same fields as original) -----
    const edited = new Trade({
      ...original.toObject(),
      _id: new mongoose.Types.ObjectId(),
      date: tradeDate,
      time: time ? moment.utc(time).format("HH:mm:ss") : original.time,
      instrumentName: instrumentName || original.instrumentName,
      equityType: equityType || original.equityType,
      quantity: quantity !== undefined ? Number(quantity) : original.quantity,
      buyingPrice:
        buyingPrice !== undefined ? Number(buyingPrice) : original.buyingPrice,
      exchangeRate:
        exchangeRate !== undefined ? Number(exchangeRate) : original.exchangeRate,
      brokerage:
        brokerage !== undefined ? Number(brokerage) : original.brokerage,
    });

    // ----- find other open trades on the same day / instrument -----
    const others = await Trade.find({
      user: req.user._id,
      date: tradeDate,
      instrumentName: edited.instrumentName,
      equityType: edited.equityType,
      isOpen: true,
      _id: { $ne: original._id },
    }).session(session);

    let resultTrades = [];
    let capitalChange = 0;

    if (others.length) {
      const same = others.find((t) => t.action === edited.action);
      const opposite = others.find((t) => t.action !== edited.action);

      if (same) {
        // merge with same-action open trade
        const { mergedTrade } = mergeTrades(same, edited);
        resultTrades.push(mergedTrade);

        if (mergedTrade.isOpen) {
          // still open → reverse original cost, apply new cost
          if (mergedTrade.action === "buy") {
            const origCost =
              original.buyingPrice * original.quantity +
              original.brokerage +
              original.exchangeRate;
            const newCost =
              mergedTrade.buyingPrice * mergedTrade.quantity +
              mergedTrade.brokerage +
              mergedTrade.exchangeRate;
            capitalChange += origCost - newCost;
          } else {
            const origProceeds =
              original.sellingPrice * original.quantity -
              original.brokerage -
              original.exchangeRate;
            const newProceeds =
              mergedTrade.sellingPrice * mergedTrade.quantity -
              mergedTrade.brokerage -
              mergedTrade.exchangeRate;
            capitalChange += newProceeds - origProceeds;
          }
        } else {
          // became complete
          capitalChange += mergedTrade.netPnl;
        }
      } else if (opposite) {
        // even-out with opposite
        const { mergedTrade, remainingTrade } = mergeTrades(opposite, edited);
        resultTrades.push(mergedTrade);
        if (remainingTrade) {
          resultTrades.push(remainingTrade);
          if (remainingTrade.action === "buy") {
            capitalChange -=
              remainingTrade.quantity * remainingTrade.buyingPrice +
              remainingTrade.brokerage +
              remainingTrade.exchangeRate;
          } else {
            capitalChange +=
              remainingTrade.quantity * remainingTrade.sellingPrice -
              remainingTrade.brokerage -
              remainingTrade.exchangeRate;
          }
        }
        capitalChange += mergedTrade.netPnl;
      } else {
        // no merge → just the edited trade
        resultTrades.push(edited);
        if (edited.action === "buy") {
          const origCost =
            original.buyingPrice * original.quantity +
            original.brokerage +
            original.exchangeRate;
          const newCost =
            edited.buyingPrice * edited.quantity +
            edited.brokerage +
            edited.exchangeRate;
          capitalChange += origCost - newCost;
        } else {
          const origProceeds =
            original.sellingPrice * original.quantity -
            original.brokerage -
            original.exchangeRate;
          const newProceeds =
            edited.sellingPrice * edited.quantity -
            edited.brokerage -
            edited.exchangeRate;
          capitalChange += newProceeds - origProceeds;
        }
      }

      // delete everything that took part in the merge
      await Trade.deleteMany({
        _id: {
          $in: [original._id, ...others.map((t) => t._id)],
        },
      }).session(session);
    } else {
      // no other open trades → replace the original
      resultTrades.push(edited);
      if (edited.action === "buy") {
        const origCost =
          original.buyingPrice * original.quantity +
          original.brokerage +
          original.exchangeRate;
        const newCost =
          edited.buyingPrice * edited.quantity +
          edited.brokerage +
          edited.exchangeRate;
        capitalChange += origCost - newCost;
      } else {
        const origProceeds =
          original.sellingPrice * original.quantity -
          original.brokerage -
          original.exchangeRate;
        const newProceeds =
          edited.sellingPrice * edited.quantity -
          edited.brokerage -
          edited.exchangeRate;
        capitalChange += newProceeds - origProceeds;
      }
      await Trade.deleteOne({ _id: original._id }).session(session);
    }

    // ----- SAVE RESULTING TRADES -----
    for (const t of resultTrades) await t.save({ session });

    // ----- UPDATE CAPITAL -----
    if (capitalChange !== 0) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(capitalChange, tradeDate);
    }

    const pointsChange = await updateUserPointsForToday(req.user._id, session);

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ trades: resultTrades, capitalChange, pointsChange });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("editOpenTrade error:", err);
    res.status(400).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// EDIT COMPLETE TRADE – merges with other complete trades (old behaviour)
// ---------------------------------------------------------------------
exports.editCompleteTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
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

    const original = await Trade.findOne({
      _id: id,
      user: req.user._id,
      action: "both",
    }).session(session);
    if (!original) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "Completed trade not found" });
    }

    const tradeDate = moment.utc(date || original.date).startOf("day").toDate();

    const edited = new Trade({
      ...original.toObject(),
      _id: new mongoose.Types.ObjectId(),
      date: tradeDate,
      time: time ? moment.utc(time).format("HH:mm:ss") : original.time,
      instrumentName: instrumentName || original.instrumentName,
      equityType: equityType || original.equityType,
      quantity: quantity !== undefined ? Number(quantity) : original.quantity,
      buyingPrice:
        buyingPrice !== undefined ? Number(buyingPrice) : original.buyingPrice,
      sellingPrice:
        sellingPrice !== undefined ? Number(sellingPrice) : original.sellingPrice,
      exchangeRate:
        exchangeRate !== undefined ? Number(exchangeRate) : original.exchangeRate,
      brokerage:
        brokerage !== undefined ? Number(brokerage) : original.brokerage,
    });

    // recalc PnL
    edited.pnl =
      (edited.sellingPrice - edited.buyingPrice) * edited.quantity;
    edited.netPnl =
      edited.pnl - edited.brokerage - edited.exchangeRate;

    // other complete trades on the same day / instrument
    const others = await Trade.find({
      user: req.user._id,
      date: tradeDate,
      instrumentName: edited.instrumentName,
      equityType: edited.equityType,
      action: "both",
      _id: { $ne: original._id },
    }).session(session);

    let finalTrade = edited;
    let capitalChange = 0;

    if (others.length) {
      // merge sequentially with every existing complete trade
      for (const other of others) {
        const { mergedTrade } = mergeTrades(finalTrade, other);
        finalTrade = mergedTrade;
      }
      finalTrade.isOpen = false;

      const oldTotalNet = original.netPnl + others.reduce((s, t) => s + t.netPnl, 0);
      capitalChange = finalTrade.netPnl - oldTotalNet;

      await Trade.deleteMany({
        _id: { $in: [original._id, ...others.map((t) => t._id)] },
      }).session(session);
    } else {
      capitalChange = edited.netPnl - original.netPnl;
      await Trade.deleteOne({ _id: original._id }).session(session);
    }

    await finalTrade.save({ session });

    if (capitalChange !== 0) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(capitalChange, tradeDate);
    }

    const pointsChange = await updateUserPointsForToday(req.user._id, session);

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ trade: finalTrade, capitalChange, pointsChange });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("editCompleteTrade error:", err);
    res.status(400).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// DELETE TRADE – reverse capital impact (same as old code)
// ---------------------------------------------------------------------
exports.deleteTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const trade = await Trade.findOne({ _id: id, user: req.user._id }).session(session);
    if (!trade) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "Trade not found" });
    }

    const tradeDate = moment.utc(trade.date).startOf("day").toDate();
    let capitalChange = 0;

    if (trade.isOpen) {
      if (trade.action === "buy") {
        capitalChange +=
          trade.quantity * trade.buyingPrice +
          trade.brokerage +
          trade.exchangeRate;
      } else if (trade.action === "sell") {
        capitalChange -=
          trade.quantity * trade.sellingPrice -
          trade.brokerage -
          trade.exchangeRate;
      }
    } else if (trade.action === "both") {
      capitalChange = -trade.netPnl;
    }

    await Trade.deleteOne({ _id: id }).session(session);

    if (capitalChange !== 0) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(capitalChange, tradeDate);
    }

    const pointsChange = await updateUserPointsForToday(req.user._id, session);

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ message: "Trade deleted", capitalChange, pointsChange });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("deleteTrade error:", err);
    res.status(400).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// GET ALL USER TRADES (latest first)
// ---------------------------------------------------------------------
exports.getUserTrades = async (req, res) => {
  try {
    const trades = await Trade.find({ user: req.user._id })
      .sort({ date: -1, time: -1 })
      .select("date time instrumentName action quantity netPnl");
    res.status(200).json(trades);
  } catch (err) {
    console.error("getUserTrades error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// MERGE TWO OPEN TRADES (optional API – unchanged)
// ---------------------------------------------------------------------
exports.mergeTradesAPI = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { buyTradeId, sellTradeId } = req.body;
    const buy = await Trade.findOne({ _id: buyTradeId, user: req.user._id, isOpen: true }).session(session);
    const sell = await Trade.findOne({ _id: sellTradeId, user: req.user._id, isOpen: true }).session(session);
    if (!buy || !sell) throw new Error("One of the trades not found or not open");

    const { mergedTrade, remainingTrade } = mergeTrades(buy, sell);
    await Trade.deleteMany({ _id: { $in: [buy._id, sell._id] } }).session(session);
    await mergedTrade.save({ session });
    if (remainingTrade) await remainingTrade.save({ session });

    const pointsChange = await updateUserPointsForToday(req.user._id, session);
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ mergedTrade, remainingTrade, pointsChange });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("mergeTradesAPI error:", err);
    res.status(400).json({ error: err.message });
  }
};

module.exports = exports;