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
  authorityDate: {
    type: Date,
    default: null, // Null indicates the rule is not part of the master list
  },
});

module.exports = mongoose.model("Rule", RuleSchema);
