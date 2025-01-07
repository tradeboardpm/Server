const mongoose = require("mongoose");

const announcementViewSchema = new mongoose.Schema(
  {
    announcementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Announcement",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

const AnnouncementView = mongoose.model(
  "AnnouncementView",
  announcementViewSchema
);

module.exports = AnnouncementView;
