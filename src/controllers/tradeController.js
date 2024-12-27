const Trade = require("../models/Trade");
const User = require("../models/User");
const moment = require("moment");
const mongoose = require("mongoose");

// Helper function to merge trades
const mergeTrades = (existingTrade, newTrade) => {
  if (existingTrade.action === "both" && newTrade.action === "both") {
    // Merging two complete trades
    const totalQuantity = existingTrade.quantity + newTrade.quantity;
    existingTrade.buyingPrice =
      (existingTrade.buyingPrice * existingTrade.quantity +
        newTrade.buyingPrice * newTrade.quantity) /
      totalQuantity;
    existingTrade.sellingPrice =
      (existingTrade.sellingPrice * existingTrade.quantity +
        newTrade.sellingPrice * newTrade.quantity) /
      totalQuantity;
    existingTrade.quantity = totalQuantity;
    existingTrade.brokerage += newTrade.brokerage;
    existingTrade.exchangeRate += newTrade.exchangeRate;
    existingTrade.pnl =
      (existingTrade.sellingPrice - existingTrade.buyingPrice) *
      existingTrade.quantity;
    existingTrade.netPnl =
      existingTrade.pnl -
      (existingTrade.brokerage + existingTrade.exchangeRate);

    return { mergedTrade: existingTrade, remainingTrade: null };
  } else if (existingTrade.action !== newTrade.action) {
    // Merging buy and sell trades
    const minQuantity = Math.min(existingTrade.quantity, newTrade.quantity);
    const remainingQuantity = Math.abs(
      existingTrade.quantity - newTrade.quantity
    );

    existingTrade.quantity = minQuantity;
    existingTrade.buyingPrice =
      existingTrade.action === "buy"
        ? existingTrade.buyingPrice
        : newTrade.buyingPrice;
    existingTrade.sellingPrice =
      existingTrade.action === "sell"
        ? existingTrade.sellingPrice
        : newTrade.sellingPrice;
    existingTrade.action = "both";
    existingTrade.isOpen = false;
    existingTrade.brokerage += newTrade.brokerage;
    existingTrade.exchangeRate += newTrade.exchangeRate;
    existingTrade.pnl =
      (existingTrade.sellingPrice - existingTrade.buyingPrice) * minQuantity;
    existingTrade.netPnl =
      existingTrade.pnl -
      (existingTrade.brokerage + existingTrade.exchangeRate);

    // Create a new trade for the remaining quantity if any
    const remainingTrade =
      remainingQuantity > 0
        ? new Trade({
            ...newTrade.toObject(),
            quantity: remainingQuantity,
            _id: undefined,
          })
        : null;

    return { mergedTrade: existingTrade, remainingTrade };
  } else {
    // Merging trades with the same action (both 'buy' or both 'sell')
    const totalQuantity = existingTrade.quantity + newTrade.quantity;
    if (existingTrade.action === "buy") {
      existingTrade.buyingPrice =
        (existingTrade.buyingPrice * existingTrade.quantity +
          newTrade.buyingPrice * newTrade.quantity) /
        totalQuantity;
    } else if (existingTrade.action === "sell") {
      existingTrade.sellingPrice =
        (existingTrade.sellingPrice * existingTrade.quantity +
          newTrade.sellingPrice * newTrade.quantity) /
        totalQuantity;
    }
    existingTrade.quantity = totalQuantity;
    existingTrade.brokerage += newTrade.brokerage;
    existingTrade.exchangeRate += newTrade.exchangeRate;

    return { mergedTrade: existingTrade, remainingTrade: null };
  }
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

    // Check if user has reached their daily trade limit
    const today = moment.utc().startOf("day");
    const tradesCount = await Trade.countDocuments({
      user: user._id,
      createdAt: { $gte: today.toDate() },
    }).session(session);

    // Commented out as per the attachment
    // if (tradesCount >= user.tradesPerDay) {
    //   await session.abortTransaction();
    //   session.endSession();
    //   return res.status(400).json({ message: "Daily trade limit reached" });
    // }

    const newTrade = new Trade({
      ...req.body,
      user: user._id,
      date: moment.utc(req.body.date, "YYYY-MM-DD").toDate(),
      brokerage: user.brokerage,
    });

    // Check for existing open trade on the same date
    const existingOpenTrade = await Trade.findOne({
      user: user._id,
      date: newTrade.date,
      instrumentName: newTrade.instrumentName,
      equityType: newTrade.equityType,
      isOpen: true,
    }).session(session);

    let resultTrade;
    let capitalChange = 0;

    if (existingOpenTrade) {
      const { mergedTrade, remainingTrade } = mergeTrades(
        existingOpenTrade,
        newTrade
      );
      await mergedTrade.save({ session });

      if (remainingTrade) {
        await remainingTrade.save({ session });
      }

      resultTrade = mergedTrade;
      if (mergedTrade.action === "both") {
        capitalChange = mergedTrade.netPnl;
      }
    } else {
      // Check for existing complete trade on the same date
      const existingCompleteTrade = await Trade.findOne({
        user: user._id,
        date: newTrade.date,
        instrumentName: newTrade.instrumentName,
        equityType: newTrade.equityType,
        action: "both",
      }).session(session);

      if (existingCompleteTrade && newTrade.action === "both") {
        const { mergedTrade } = mergeTrades(existingCompleteTrade, newTrade);
        await mergedTrade.save({ session });
        resultTrade = mergedTrade;
        capitalChange = mergedTrade.netPnl - existingCompleteTrade.netPnl;
      } else {
        await newTrade.save({ session });
        resultTrade = newTrade;
        if (newTrade.action === "both") {
          capitalChange = newTrade.netPnl;
        }
      }
    }

    // Update user's capital for completed trades
    if (capitalChange !== 0) {
      await user.updateCapital(capitalChange, resultTrade.date);
    }

    await session.commitTransaction();
    session.endSession();
    res.status(201).json(resultTrade);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ message: error.message });
  }
};

exports.editOpenTrade = async (req, res) => {
  try {
    const trade = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
      isOpen: true,
    });
    if (!trade) {
      return res.status(404).json({ message: "Open trade not found" });
    }
    Object.assign(trade, req.body);
    await trade.save();
    res.status(200).json(trade);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.editCompleteTrade = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const trade = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
      action: "both",
    }).session(session);
    if (!trade) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Complete trade not found" });
    }
    const oldNetPnl = trade.netPnl;
    Object.assign(trade, req.body);
    await trade.save({ session });

    // Update user's capital
    const user = await User.findById(req.user._id).session(session);
    await user.updateCapital(trade.netPnl - oldNetPnl, trade.date);

    await session.commitTransaction();
    session.endSession();
    res.status(200).json(trade);
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
    const trade = await Trade.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    }).session(session);
    if (!trade) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Trade not found" });
    }

    // If it was a complete trade, update user's capital
    if (trade.action === "both") {
      const user = await User.findById(req.user._id).session(session);
      await user.updateCapital(-trade.netPnl, trade.date);
    }

    await session.commitTransaction();
    session.endSession();
    res.status(200).json({ message: "Trade deleted successfully" });
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
