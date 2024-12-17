// models/RuleFollowed.js
const mongoose = require("mongoose");

const RuleFollowedSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  rule: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Rule",
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  isFollowed: {
    type: Boolean,
    default: false,
  },
});

module.exports = mongoose.model("RuleFollowed", RuleFollowedSchema);
