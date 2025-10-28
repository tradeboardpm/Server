const mongoose = require("mongoose");

const accountabilityPartnerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    relation: {
      type: String,
      required: true,
      trim: true,
    },
    dataToShare: {
      capital: { type: Boolean, default: false },
      rulesFollowed: { type: Boolean, default: false },
      winRate: { type: Boolean, default: false },
      tradesTaken: { type: Boolean, default: false },
      profitLoss: { type: Boolean, default: false },
      dateRangeMetrics: { type: Boolean, default: false },
      currentPoints: { type: Boolean, default: false },
    },
    shareFrequency: {
      type: String,
      enum: ["weekly", "monthly"],
      required: true,
      default: "weekly",
    },
    lastSharedDate: {
      type: Date,
      default: null,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Unique per user + email
accountabilityPartnerSchema.index({ user: 1, email: 1 }, { unique: true });

const AccountabilityPartner = mongoose.model(
  "AccountabilityPartner",
  accountabilityPartnerSchema
);

module.exports = AccountabilityPartner;