const mongoose = require("mongoose");

const tradeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    time: {
      type: String,
      required: true,
    },
    instrumentName: {
      type: String,
      required: true,
      trim: true,
    },
    equityType: {
      type: String,
      required: true,
      enum: ["F&O-OPTIONS", "F&O-FUTURES", "INTRADAY", "DELIVERY", "OTHERS"],
    },
    action: {
      type: String,
      required: true,
      enum: ["buy", "sell", "both"],
    },
    quantity: {
      type: Number,
      required: true,
    },
    buyingPrice: {
      type: Number,
    },
    sellingPrice: {
      type: Number,
    },
    exchangeRate: {
      type: Number,
      default: 1,
    },
    brokerage: {
      type: Number,
      required: true,
    },
    charges: {
      stt: Number,
      transactionFee: Number,
      sebiCharges: Number,
      stampDuty: Number,
      gst: Number,
      dpCharges: Number,
      totalCharges: Number,
    },
    grossPnL: Number,
    netPnL: Number,
  },
  {
    timestamps: true,
  }
);

const Trade = mongoose.model("Trade", tradeSchema);

module.exports = Trade;
