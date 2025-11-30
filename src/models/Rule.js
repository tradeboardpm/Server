const mongoose = require("mongoose");

const RuleSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    default: null,
  },
});

module.exports = mongoose.model("Rule", RuleSchema);