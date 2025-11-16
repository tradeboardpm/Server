// src/utils/tradeHelper.js
const mongoose = require("mongoose");
const Trade = require("../models/Trade");
const { updateUserPointsForToday } = require("./pointsHelper");

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


module.exports = { mergeTrades };