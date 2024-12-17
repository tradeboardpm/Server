const mongoose = require("mongoose");

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
    points: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);


// Add a method to remove a file from attachedFiles
journalSchema.methods.removeFile = function (fileKey) {
  const fileIndex = this.attachedFiles.findIndex((file) =>
    file.endsWith(fileKey)
  );
  if (fileIndex !== -1) {
    this.attachedFiles.splice(fileIndex, 1);
  }
};

const Journal = mongoose.model("Journal", journalSchema);

module.exports = Journal;
