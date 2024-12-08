const Trade = require("../models/Trade");
const User = require("../models/User");
const {
  calculateCharges,
  calculateGrossPnL,
  calculateNetPnL,
  initializeChargeRates,
} = require("../utils/tradeCalculations");
const moment = require("moment");

async function updateUserCapital(userId, pnLChange, date) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    await user.updateCapital(pnLChange, moment.utc(date).toDate());
    console.log("Capital updated:", user.capital);
  } catch (error) {
    console.error("Error updating capital:", error);
    throw error;
  }
}

async function createOrUpdateTrade(userId, tradeData) {
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
  } = tradeData;

  const tradeDate = moment.utc(date).startOf("day").toDate();
  const action = buyingPrice ? "buy" : "sell";

  let existingTrades = await Trade.find({
    user: userId,
    date: tradeDate,
    instrumentName,
    equityType,
  }).sort({ createdAt: 1 });

  let remainingQuantity = quantity;
  let newTrades = [];
  let completedTrades = [];
  let netPnLChange = 0;

  // First, try to merge with existing trades
  for (let existingTrade of existingTrades) {
    if (existingTrade.action !== action && remainingQuantity > 0) {
      const matchedQuantity = Math.min(
        existingTrade.quantity,
        remainingQuantity
      );
      remainingQuantity -= matchedQuantity;

      // Update existing trade
      existingTrade.quantity -= matchedQuantity;
      if (existingTrade.quantity === 0) {
        await Trade.findByIdAndDelete(existingTrade._id);
      } else {
        await existingTrade.save();
      }

      // Create completed trade
      const completedTrade = new Trade({
        user: userId,
        date: tradeDate,
        time,
        instrumentName,
        equityType,
        action: "both",
        quantity: matchedQuantity,
        buyingPrice: action === "buy" ? buyingPrice : existingTrade.buyingPrice,
        sellingPrice:
          action === "sell" ? sellingPrice : existingTrade.sellingPrice,
        exchangeRate,
        brokerage: (brokerage * matchedQuantity) / quantity,
      });

      const charges = await calculateCharges({
        equityType,
        action: "both",
        price: completedTrade.sellingPrice,
        quantity: matchedQuantity,
        brokerage: completedTrade.brokerage,
      });

      completedTrade.charges = charges;
      completedTrade.grossPnL = calculateGrossPnL({
        action: "both",
        buyingPrice: completedTrade.buyingPrice,
        sellingPrice: completedTrade.sellingPrice,
        quantity: matchedQuantity,
      });
      completedTrade.netPnL = calculateNetPnL({
        grossPnL: completedTrade.grossPnL,
        charges,
      });

      await completedTrade.save();
      completedTrades.push(completedTrade);
      netPnLChange += completedTrade.netPnL;
    }
  }

  // If there's remaining quantity, create a new trade
  if (remainingQuantity > 0) {
    const newTrade = new Trade({
      user: userId,
      date: tradeDate,
      time,
      instrumentName,
      equityType,
      action,
      quantity: remainingQuantity,
      buyingPrice: action === "buy" ? buyingPrice : null,
      sellingPrice: action === "sell" ? sellingPrice : null,
      exchangeRate,
      brokerage: (brokerage * remainingQuantity) / quantity,
    });

    await newTrade.save();
    newTrades.push(newTrade);
  }

  return { completedTrades, newTrades, netPnLChange };
}

exports.createTrade = async (req, res) => {
  try {
    await initializeChargeRates();

    const { completedTrades, newTrades, netPnLChange } =
      await createOrUpdateTrade(req.user._id, req.body);

    await updateUserCapital(req.user._id, netPnLChange, req.body.date);

    res.status(201).send({
      completedTrades,
      openTrades: newTrades,
    });
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

    if (!trade.isOpen) {
      return res.status(400).send({ error: "Cannot update a completed trade" });
    }

    const oldNetPnL = trade.netPnL || 0;

    await Trade.findByIdAndDelete(trade._id);

    const { completedTrades, newTrades, netPnLChange } =
      await createOrUpdateTrade(req.user._id, {
        ...trade.toObject(),
        ...req.body,
      });

    await updateUserCapital(
      req.user._id,
      netPnLChange - oldNetPnL,
      req.body.date || trade.date
    );

    res.send({
      completedTrades,
      openTrades: newTrades,
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

// exports.deleteTrade = async (req, res) => {
//   try {
//     const trade = await Trade.findOneAndDelete({
//       _id: req.params.id,
//       user: req.user._id,
//     });

//     if (!trade) {
//       return res.status(404).send({ error: "Trade not found" });
//     }

//     if (!trade.isOpen) {
//       await updateUserCapital(req.user._id, -trade.netPnL, trade.date);
//     }

//     res.send({ message: "Trade deleted successfully", trade });
//   } catch (error) {
//     res.status(500).send({ error: error.message });
//   }
// };

exports.getTrades = async (req, res) => {
  try {
    const { date } = req.query;
    let query = { user: req.user._id };

    if (date) {
      const startOfDay = moment.utc(date).startOf("day").toDate();
      const endOfDay = moment.utc(date).endOf("day").toDate();
      query.date = { $lte: endOfDay };
      query.$or = [
        { date: { $gte: startOfDay, $lte: endOfDay } },
        { isOpen: true },
      ];
    }

    const trades = await Trade.find(query).sort({ date: -1, isOpen: -1 });
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

    const startOfDay = moment.utc(date).startOf("day").toDate();
    const endOfDay = moment.utc(date).endOf("day").toDate();

    const trades = await Trade.find({
      user: req.user._id,
      $or: [
        { date: { $gte: startOfDay, $lte: endOfDay } },
        { isOpen: true, date: { $lte: endOfDay } },
      ],
    }).sort({ date: -1, isOpen: -1 });

    let totalPnL = 0;
    let totalCharges = 0;
    let netPnL = 0;

    trades.forEach((trade) => {
      if (trade.grossPnL) totalPnL += trade.grossPnL;
      if (trade.charges && trade.charges.totalCharges)
        totalCharges += trade.charges.totalCharges;
      if (trade.netPnL) netPnL += trade.netPnL;
    });

    res.send({
      trades,
      summary: {
        totalPnL,
        totalCharges,
        netPnL,
      },
    });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.getCapital = async (req, res) => {
  try {
    let capital = await Capital.findOne({ user: req.user._id });

    if (!capital) {
      capital = new Capital({
        user: req.user._id,
        amount: 100000, // Default initial capital
      });
      await capital.save();
    }

    res.send(capital);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};


exports.importTrades = async (req, res) => {
  try {
    await initializeChargeRates(); // Ensure charge rates are initialized

    const trades = req.body;
    let totalNetPnLChange = 0;
    const importedTrades = [];

    for (let tradeData of trades) {
      // Validate and normalize trade data
      const normalizedTrade = {
        date: tradeData.date,
        time: tradeData.time || moment().format("HH:mm"),
        instrumentName: tradeData.instrumentName,
        equityType: tradeData.equityType,
        quantity: Number(tradeData.quantity),
        buyingPrice: Number(tradeData.buyingPrice) || 0,
        sellingPrice: Number(tradeData.sellingPrice) || 0,
        exchangeRate: Number(tradeData.exchangeRate) || 1,
        brokerage: Number(tradeData.brokerage) || 0,
      };

      // Validate required fields
      if (
        !normalizedTrade.instrumentName ||
        !normalizedTrade.quantity ||
        !normalizedTrade.equityType ||
        !normalizedTrade.date
      ) {
        throw new Error(`Invalid trade data: ${JSON.stringify(tradeData)}`);
      }

      // Determine trade action
      const action = normalizedTrade.buyingPrice
        ? "buy"
        : normalizedTrade.sellingPrice
        ? "sell"
        : "both";

      // Prepare trade data for creation
      const tradeToCreate = {
        ...normalizedTrade,
        user: req.user._id,
        action: action,
      };

      // Create or update trade
      const { completedTrades, newTrades, netPnLChange } =
        await createOrUpdateTrade(req.user._id, tradeToCreate);

      // Accumulate total net P&L change
      totalNetPnLChange += netPnLChange;

      // Combine completed and new trades
      importedTrades.push(...completedTrades, ...newTrades);
    }

    // If there's a net P&L change, update user capital
    if (totalNetPnLChange !== 0 && importedTrades.length > 0) {
      await updateUserCapital(
        req.user._id,
        totalNetPnLChange,
        importedTrades[0].date
      );
    }

    res.status(201).json(importedTrades);
  } catch (error) {
    console.error("Error importing trades:", error);
    res.status(400).json({ error: error.message });
  }
};

async function processTrade(trade) {
  trade.price = trade.action === "buy" ? trade.buyingPrice : trade.sellingPrice;
  const charges = await calculateCharges(trade);
  trade.charges = charges;
  trade.grossPnL = calculateGrossPnL(trade);
  trade.netPnL = calculateNetPnL({ grossPnL: trade.grossPnL, charges });
}



exports.deleteTrade = async (req, res) => {
  try {
    const trade = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!trade) {
      return res.status(404).send({ error: "Trade not found" });
    }

    const pnLChange = trade.isOpen ? 0 : -(trade.netPnL || 0);

    await Trade.findByIdAndDelete(trade._id);

    try {
      await updateUserCapital(req.user._id, pnLChange, trade.date);
    } catch (capitalError) {
      console.error("Error updating capital:", capitalError);
      // Continue with the deletion even if capital update fails
    }

    res.send({ message: "Trade deleted successfully" });
  } catch (error) {
    console.error("Error deleting trade:", error);
    res
      .status(500)
      .send({ error: "An error occurred while deleting the trade" });
  }
};