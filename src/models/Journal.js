const mongoose = require("mongoose");

const ruleSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      required: true,
      trim: true,
    },
    originalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rule",
      required: true,
    },
  },
  { _id: false }
);

const journalSchema = new mongoose.Schema(
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
    note: {
      type: String,
      trim: true,
    },
    mistake: {
      type: String,
      trim: true,
    },
    lesson: {
      type: String,
      trim: true,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    attachedFiles: [
      {
        type: String,
      },
    ],
    rulesFollowed: [ruleSchema],
    rulesUnfollowed: [ruleSchema],
    points: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const Journal = mongoose.model("Journal", journalSchema);

module.exports = Journal;