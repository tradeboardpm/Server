// utils/tradeHelper.js
const mongoose = require("mongoose");
const Trade = require("../models/Trade");

const closeWithOpposite = (openTrade, closingTrade) => {
  const openQty = openTrade.quantity;
  const closeQty = closingTrade.quantity || openQty;
  const closedQty = Math.min(openQty, closeQty);

  // Determine buy and sell prices safely
  let buyPrice, sellPrice;

  if (openTrade.action === "buy") {
    buyPrice = openTrade.buyingPrice;        // from open position
    sellPrice = closingTrade.sellingPrice;   // from closing trade
  } else {
    // openTrade is sell → closing with buy
    buyPrice = closingTrade.buyingPrice;     // from closing trade
    sellPrice = openTrade.sellingPrice;      // from open position
  }

  // SAFETY: Ensure prices are numbers (never null/undefined)
  buyPrice = Number(buyPrice) || 0;
  sellPrice = Number(sellPrice) || 0;

  const completed = new Trade({
    user: openTrade.user,
    date: closingTrade.date,
    time: closingTrade.time || "09:30:00",
    instrumentName: openTrade.instrumentName,
    equityType: openTrade.equityType,
    action: "both",
    quantity: closedQty,
    buyingPrice: Number(buyPrice.toFixed(2)),
    sellingPrice: Number(sellPrice.toFixed(2)),
    exchangeRate: Number((closingTrade.exchangeRate || 0) + (openTrade.exchangeRate || 0) * (closedQty / openQty)).toFixed(2),
    brokerage: Number((closingTrade.brokerage || 0) + (openTrade.brokerage || 0) * (closedQty / openQty)).toFixed(2),
    isOpen: false,
  });

  completed.pnl = (sellPrice - buyPrice) * closedQty;
  completed.netPnl = completed.pnl - completed.brokerage - completed.exchangeRate;

  let remaining = null;
  if (openQty > closeQty) {
    const remainingQty = openQty - closeQty;
    const ratio = remainingQty / openQty;

    remaining = new Trade({
      ...openTrade.toObject(),
      _id: new mongoose.Types.ObjectId(),
      quantity: remainingQty,
      exchangeRate: (openTrade.exchangeRate || 0) * ratio,
      brokerage: (openTrade.brokerage || 0) * ratio,
    });
  }

  return { completedTrade: completed, remainingTrade: remaining };
};

module.exports = { closeWithOpposite };