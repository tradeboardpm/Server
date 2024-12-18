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
    isOpen: {
      type: Boolean,
      default: true,
    },
    matchedTrade: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trade",
    },
    pnl: {
      type: Number,
      default: 0,
    },
    netPnl: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save middleware to calculate PnL
tradeSchema.pre("save", function (next) {
  // Only calculate PnL for completed trades (action 'both')
  if (this.action === "both" && this.buyingPrice && this.sellingPrice) {
    // Gross PnL (before charges)
    this.pnl = (this.sellingPrice - this.buyingPrice) * this.quantity;

    // Net PnL (after subtracting charges)
    this.netPnl = this.pnl - (this.exchangeRate + this.brokerage);
  } else {
    this.pnl = 0;
    this.netPnl = 0;
  }
  next();
});

const Trade = mongoose.model("Trade", tradeSchema);

module.exports = Trade;
