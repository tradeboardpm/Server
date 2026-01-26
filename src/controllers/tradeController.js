// controllers/tradeController.js
// FULL COPY-PASTE READY — EVERYTHING INCLUDED
const mongoose = require("mongoose");
const Trade = require("../models/Trade");
const User = require("../models/User");
const moment = require("moment");
const { updateUserPointsForToday } = require("../utils/pointsHelper");
const { closeWithOpposite } = require("../utils/tradeHelper");

// BEST formatTradeTime EVER — ZERO WARNINGS, ZERO ERRORS
const formatTradeTime = (input) => {
  if (!input) return "09:30:00";

  const str = String(input).trim();

  // Case 1: Already perfect HH:mm:ss
  if (/^\d{2}:\d{2}:\d{2}$/.test(str)) return str;

  // Case 2: HH:mm or H:mm format (most common)
  if (/^\d{1,2}:\d{2}$/.test(str)) {
    const [h, m] = str.split(":");
    return `${h.padStart(2, "0")}:${m}:00`;
  }

  // Case 3: With AM/PM → e.g. "9:30 AM"
  if (/\d{1,2}:\d{2}\s?[APap][Mm]/.test(str)) {
    const parsed = moment(str, ["h:mm A", "h:mmA", "H:mm"], true);
    if (parsed.isValid()) return parsed.format("HH:mm:ss");
  }

  // Case 4: Full ISO or valid datetime string
  const full = moment.utc(str);
  if (full.isValid()) {
    return full.format("HH:mm:ss");
  }

  // Final fallback
  return "09:30:00";
};

// GET TRADES BY DATE (with carried forward + original date/time)
exports.getTradesByDate = async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Date required" });

    const queryDate = moment.utc(date).startOf("day").toDate();
    const endOfDay = moment.utc(date).endOf("day").toDate();

    const dayTrades = await Trade.find({
      user: req.user._id,
      date: { $gte: queryDate, $lte: endOfDay },
    })
      .sort({ time: 1 })
      .lean();

    dayTrades.forEach(t => (t.time = formatTradeTime(t.time)));

    const openPast = await Trade.find({
      user: req.user._id,
      date: { $lt: queryDate },
      isOpen: true,
    }).lean();

    const positions = {};
    openPast.forEach(t => {
      const key = `${t.instrumentName}-${t.equityType}`;
      if (!positions[key]) {
        positions[key] = { buy: 0, sell: 0, buyTotal: 0, sellTotal: 0, qtyBuy: 0, qtySell: 0, trades: [] };
      }
      if (t.action === "buy") {
        positions[key].buy += t.quantity;
        positions[key].buyTotal += t.buyingPrice * t.quantity;
        positions[key].qtyBuy += t.quantity;
      } else {
        positions[key].sell += t.quantity;
        positions[key].sellTotal += t.sellingPrice * t.quantity;
        positions[key].qtySell += t.quantity;
      }
      positions[key].trades.push(t);
    });

    const carriedForward = [];
    Object.keys(positions).forEach(key => {
      const p = positions[key];
      const netBuy = p.buy - p.sell;
      const netSell = p.sell - p.buy;
      if (netBuy === 0 && netSell === 0) return;

      const rep = p.trades.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      const avgBuy = p.qtyBuy > 0 ? p.buyTotal / p.qtyBuy : 0;
      const avgSell = p.qtySell > 0 ? p.sellTotal / p.qtySell : 0;

      carriedForward.push({
        ...rep,
        _id: rep._id,
        quantity: Math.abs(netBuy > 0 ? netBuy : netSell),
        buyingPrice: netBuy > 0 ? Number(avgBuy.toFixed(2)) : undefined,
        sellingPrice: netSell > 0 ? Number(avgSell.toFixed(2)) : undefined,
        carriedForward: true,
        isOpen: true,
        displayDate: rep.date,
        displayTime: formatTradeTime(rep.time),
      });
    });

    const allTrades = [...carriedForward, ...dayTrades].sort((a, b) => {
      if (a.carriedForward && !b.carriedForward) return -1;
      if (!a.carriedForward && b.carriedForward) return 1;
      return (a.time || "").localeCompare(b.time || "");
    });

    let totalPnL = 0, totalCharges = 0, netPnL = 0;
    allTrades.forEach(t => {
      if (t.action === "both") {
        const gross = (t.netPnl || 0) + (t.brokerage || 0) + (t.exchangeRate || 0);
        totalPnL += gross;
        totalCharges += (t.brokerage || 0) + (t.exchangeRate || 0);
        netPnL += t.netPnl || 0;
      }
    });

    res.json({
      trades: allTrades,
      summary: {
        totalTrades: dayTrades.length,
        totalPnL: Number(totalPnL.toFixed(2)),
        totalCharges: Number(totalCharges.toFixed(2)),
        netPnL: Number(netPnL.toFixed(2)),
      },
    });
  } catch (err) {
    consoleole.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

// ADD TRADE
exports.addTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      date, time, instrumentName, equityType,
      action, quantity, buyingPrice, sellingPrice,
      exchangeRate = 0, brokerage = 0,
    } = req.body;

    const tradeDate = moment.utc(date).startOf("day").toDate();
    const tradeTime = formatTradeTime(time);

    let capitalChange = 0;
    const tradesToSave = [];
    const tradesToDelete = [];

    if (action === "both") {
      const completed = new Trade({
        user: req.user._id,
        date: tradeDate,
        time: tradeTime,
        instrumentName,
        equityType,
        action: "both",
        quantity: Number(quantity),
        buyingPrice: Number(buyingPrice),
        sellingPrice: Number(sellingPrice),
        exchangeRate: Number(exchangeRate),
        brokerage: Number(brokerage),
        isOpen: false,
        pnl: (sellingPrice - buyingPrice) * quantity,
        netPnl: (sellingPrice - buyingPrice) * quantity - exchangeRate - brokerage,
      });
      capitalChange = completed.netPnl;
      tradesToSave.push(completed);
    } else {
      const oppositeAction = action === "buy" ? "sell" : "buy";
      const openOpposite = await Trade.findOne({
        user: req.user._id,
        instrumentName,
        equityType,
        action: oppositeAction,
        isOpen: true,
      })
        .sort({ date: -1, time: -1 })
        .session(session);

      const qty = Number(quantity);
      const price = action === "buy" ? Number(buyingPrice) : Number(sellingPrice);

      if (openOpposite && openOpposite.quantity > 0) {
        const closingTrade = {
          date: tradeDate,
          time: tradeTime,
          quantity: qty,
          buyingPrice: action === "buy" ? price : undefined,
          sellingPrice: action === "sell" ? price : undefined,
          exchangeRate: Number(exchangeRate),
          brokerage: Number(brokerage),
        };

        const { completedTrade, remainingTrade } = closeWithOpposite(openOpposite, closingTrade);

        tradesToDelete.push(openOpposite._id);
        tradesToSave.push(completedTrade);
        if (remainingTrade) tradesToSave.push(remainingTrade);

        if (action === "buy") {
          // Closing a Sell position (Buy to Close)
          const entryValue = qty * (openOpposite.sellingPrice || 0);
          capitalChange += (2 * entryValue - qty * price - brokerage - exchangeRate);
        } else {
          // Closing a Buy position (Sell to Close)
          capitalChange += (qty * price - brokerage - exchangeRate);
        }
      } else {
        const openTrade = new Trade({
          user: req.user._id,
          date: tradeDate,
          time: tradeTime,
          instrumentName,
          equityType,
          action,
          quantity: qty,
          buyingPrice: action === "buy" ? price : undefined,
          sellingPrice: action === "sell" ? price : undefined,
          exchangeRate: Number(exchangeRate),
          brokerage: Number(brokerage),
          isOpen: true,
        });
        // Both Buy and Sell entries are now deductions (blocked funds)
        capitalChange -= qty * price + brokerage + exchangeRate;
        tradesToSave.push(openTrade);
      }
    }

    if (tradesToDelete.length) await Trade.deleteMany({ _id: { $in: tradesToDelete } }).session(session);
    for (const t of tradesToSave) await t.save({ session });

    if (capitalChange !== 0) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(capitalChange, tradeDate);
    }

    await updateUserPointsForToday(req.user._id, session);
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ trades: tradesToSave.map(t => t.toObject()), capitalChange });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("addTrade error:", err);
    res.status(400).json({ error: err.message || "Failed" });
  }
};

// EDIT OPEN TRADE
exports.editOpenTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const updates = req.body;

    const trade = await Trade.findOne({ _id: id, user: req.user._id, isOpen: true }).session(session);
    if (!trade) return res.status(404).json({ error: "Open trade not found" });

    const oldCost = trade.buyingPrice * trade.quantity + trade.brokerage + trade.exchangeRate || 
                    trade.sellingPrice * trade.quantity + trade.brokerage + trade.exchangeRate;

    Object.assign(trade, updates);
    trade.time = formatTradeTime(updates.time || trade.time);
    trade.quantity = Number(updates.quantity || trade.quantity);
    trade.buyingPrice = updates.buyingPrice !== undefined ? Number(updates.buyingPrice) : trade.buyingPrice;
    trade.sellingPrice = updates.sellingPrice !== undefined ? Number(updates.sellingPrice) : trade.sellingPrice;
    trade.exchangeRate = Number(updates.exchangeRate ?? trade.exchangeRate ?? 0);
    trade.brokerage = Number(updates.brokerage ?? trade.brokerage ?? 0);

    const newCost = trade.buyingPrice * trade.quantity + trade.brokerage + trade.exchangeRate || 
                    trade.sellingPrice * trade.quantity + trade.brokerage + trade.exchangeRate;

    await trade.save({ session });

    if (oldCost !== newCost) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(newCost - oldCost, trade.date);
    }

    await session.commitTransaction();
    session.endSession();
    res.json({ trade: trade.toObject() });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ error: err.message });
  }
};

// EDIT COMPLETE TRADE
exports.editCompleteTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const updates = req.body;

    const trade = await Trade.findOne({ _id: id, user: req.user._id, action: "both" }).session(session);
    if (!trade) return res.status(404).json({ error: "Completed trade not found" });

    const oldNetPnl = trade.netPnl || 0;

    Object.assign(trade, updates);
    trade.time = formatTradeTime(updates.time || trade.time);
    trade.quantity = Number(updates.quantity);
    trade.buyingPrice = Number(updates.buyingPrice);
    trade.sellingPrice = Number(updates.sellingPrice);
    trade.exchangeRate = Number(updates.exchangeRate || 0);
    trade.brokerage = Number(updates.brokerage || 0);

    trade.pnl = (trade.sellingPrice - trade.buyingPrice) * trade.quantity;
    trade.netPnl = trade.pnl - trade.brokerage - trade.exchangeRate;

    await trade.save({ session });

    const capitalChange = trade.netPnl - oldNetPnl;
    if (capitalChange !== 0) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(capitalChange, trade.date);
    }

    await session.commitTransaction();
    session.endSession();
    res.json({ trade: trade.toObject(), capitalChange });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ error: err.message });
  }
};

// DELETE TRADE
exports.deleteTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return res.status(400).json({ error: "Invalid ID" });

    const trade = await Trade.findOne({ _id: id, user: req.user._id }).session(session);
    if (!trade) return res.status(404).json({ error: "Not found" });

    let capitalChange = 0;
    if (trade.action === "both") capitalChange = -trade.netPnl;
    else capitalChange = (trade.buyingPrice || trade.sellingPrice) * trade.quantity + trade.brokerage + trade.exchangeRate;

    await Trade.deleteOne({ _id: id }).session(session);
    if (capitalChange !== 0) {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(capitalChange, trade.date);
    }

    await session.commitTransaction();
    session.endSession();
    res.json({ message: "Deleted", capitalChange });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ error: err.message || "Delete failed" });
  }
};

// GET ALL USER TRADES (optional)
exports.getUserTrades = async (req, res) => {
  try {
    const trades = await Trade.find({ user: req.user._id })
      .sort({ date: -1, time: -1 })
      .select("date time instrumentName equityType action quantity netPnl isOpen");
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = exports;