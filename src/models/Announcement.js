const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        "downtime",
        "notification",
        "upcoming",
        "changelog",
        "feature",
        "maintenance",
      ],
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    validFrom: {
      type: Date,
      required: true,
    },
    validUntil: {
      type: Date,
      required: true,
    },
    visibility: {
      type: String,
      required: true,
      enum: ["once", "daily", "always"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const Announcement = mongoose.model("Announcement", announcementSchema);

module.exports = Announcement;
