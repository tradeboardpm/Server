const Trade = require("../models/Trade");
const User = require("../models/User");
const moment = require("moment");

// Helper function to merge trades
const mergeTrades = (existingTrade, newTrade) => {
  if (existingTrade.action === 'both' && newTrade.action === 'both') {
    // Merging two complete trades
    const totalQuantity = existingTrade.quantity + newTrade.quantity;
    existingTrade.buyingPrice = (existingTrade.buyingPrice * existingTrade.quantity + newTrade.buyingPrice * newTrade.quantity) / totalQuantity;
    existingTrade.sellingPrice = (existingTrade.sellingPrice * existingTrade.quantity + newTrade.sellingPrice * newTrade.quantity) / totalQuantity;
    existingTrade.quantity = totalQuantity;
    existingTrade.brokerage += newTrade.brokerage;
    existingTrade.exchangeRate += newTrade.exchangeRate;
    existingTrade.pnl = (existingTrade.sellingPrice - existingTrade.buyingPrice) * existingTrade.quantity;
    existingTrade.netPnl = existingTrade.pnl - (existingTrade.brokerage + existingTrade.exchangeRate);

    return { mergedTrade: existingTrade, remainingTrade: null };
  } else if (existingTrade.action !== newTrade.action) {
    // Merging buy and sell trades
    const minQuantity = Math.min(existingTrade.quantity, newTrade.quantity);
    const remainingQuantity = Math.abs(existingTrade.quantity - newTrade.quantity);

    existingTrade.quantity = minQuantity;
    existingTrade.buyingPrice = existingTrade.action === 'buy' ? existingTrade.buyingPrice : newTrade.buyingPrice;
    existingTrade.sellingPrice = existingTrade.action === 'sell' ? existingTrade.sellingPrice : newTrade.sellingPrice;
    existingTrade.action = 'both';
    existingTrade.isOpen = false;
    existingTrade.brokerage += newTrade.brokerage;
    existingTrade.exchangeRate += newTrade.exchangeRate;
    existingTrade.pnl = (existingTrade.sellingPrice - existingTrade.buyingPrice) * minQuantity;
    existingTrade.netPnl = existingTrade.pnl - (existingTrade.brokerage + existingTrade.exchangeRate);

    // Create a new trade for the remaining quantity if any
    const remainingTrade = remainingQuantity > 0 ? new Trade({
      ...newTrade.toObject(),
      quantity: remainingQuantity,
      _id: undefined
    }) : null;

    return { mergedTrade: existingTrade, remainingTrade };
  } else {
    // Merging trades with the same action (both 'buy' or both 'sell')
    const totalQuantity = existingTrade.quantity + newTrade.quantity;
    if (existingTrade.action === 'buy') {
      existingTrade.buyingPrice = (existingTrade.buyingPrice * existingTrade.quantity + newTrade.buyingPrice * newTrade.quantity) / totalQuantity;
    } else if (existingTrade.action === 'sell') {
      existingTrade.sellingPrice = (existingTrade.sellingPrice * existingTrade.quantity + newTrade.sellingPrice * newTrade.quantity) / totalQuantity;
    }
    existingTrade.quantity = totalQuantity;
    existingTrade.brokerage += newTrade.brokerage;
    existingTrade.exchangeRate += newTrade.exchangeRate;

    return { mergedTrade: existingTrade, remainingTrade: null };
  }
};

exports.addTrade = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user has reached their daily trade limit
    const today = moment.utc().startOf('day');
    const tradesCount = await Trade.countDocuments({
      user: user._id,
      createdAt: { $gte: today.toDate() }
    });

    if (tradesCount >= user.tradesPerDay) {
      return res.status(400).json({ message: 'Daily trade limit reached' });
    }

    const newTrade = new Trade({
      ...req.body,
      user: user._id,
      date: moment.utc(req.body.date, 'DD-MM-YYYY').toDate(),
      brokerage: user.brokerage
    });

    // Check for existing open trade on the same date
    const existingOpenTrade = await Trade.findOne({
      user: user._id,
      date: newTrade.date,
      instrumentName: newTrade.instrumentName,
      equityType: newTrade.equityType,
      isOpen: true
    });

    if (existingOpenTrade) {
      const { mergedTrade, remainingTrade } = mergeTrades(existingOpenTrade, newTrade);
      await mergedTrade.save();

      if (remainingTrade) {
        await remainingTrade.save();
      }

      res.status(200).json({ mergedTrade, remainingTrade });
    } else {
      // Check for existing complete trade on the same date
      const existingCompleteTrade = await Trade.findOne({
        user: user._id,
        date: newTrade.date,
        instrumentName: newTrade.instrumentName,
        equityType: newTrade.equityType,
        action: 'both'
      });

      if (existingCompleteTrade && newTrade.action === 'both') {
        const { mergedTrade } = mergeTrades(existingCompleteTrade, newTrade);
        await mergedTrade.save();
        res.status(200).json(mergedTrade);
      } else {
        await newTrade.save();
        res.status(201).json(newTrade);
      }
    }

    // Update user's capital for completed trades
    if (newTrade.action === 'both' || (existingOpenTrade && existingOpenTrade.action !== newTrade.action)) {
      await user.updateCapital(newTrade.netPnl);
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.editOpenTrade = async (req, res) => {
  try {
    const trade = await Trade.findOne({ _id: req.params.id, user: req.user._id, isOpen: true });
    if (!trade) {
      return res.status(404).json({ message: 'Open trade not found' });
    }
    Object.assign(trade, req.body);
    await trade.save();
    res.status(200).json(trade);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.editCompleteTrade = async (req, res) => {
  try {
    const trade = await Trade.findOne({ _id: req.params.id, user: req.user._id, action: 'both' });
    if (!trade) {
      return res.status(404).json({ message: 'Complete trade not found' });
    }
    const oldNetPnl = trade.netPnl;
    Object.assign(trade, req.body);
    await trade.save();

    // Update user's capital
    const user = await User.findById(req.user._id);
    await user.updateCapital(trade.netPnl - oldNetPnl);

    res.status(200).json(trade);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deleteTrade = async (req, res) => {
  try {
    const trade = await Trade.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!trade) {
      return res.status(404).json({ message: 'Trade not found' });
    }

    // If it was a complete trade, update user's capital
    if (trade.action === 'both') {
      const user = await User.findById(req.user._id);
      await user.updateCapital(-trade.netPnl);
    }

    res.status(200).json({ message: 'Trade deleted successfully' });
  } catch (error) {
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

