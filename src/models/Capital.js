const mongoose = require("mongoose");

const capitalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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

const Capital = mongoose.model("Capital", capitalSchema);

module.exports = Capital;
