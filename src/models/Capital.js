const mongoose = require("mongoose");

const capitalSchema = new mongoose.Schema(
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
    amount: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Create a compound index on user and date to ensure uniqueness
capitalSchema.index({ user: 1, date: 1 }, { unique: true });

const Capital = mongoose.model("Capital", capitalSchema);

module.exports = Capital;
