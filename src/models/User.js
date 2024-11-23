const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 7,
      trim: true,
    },
    subscription: {
      type: String,
      enum: ["free", "premium"],
      default: "free",
    },
    subscriptionValidUntil: {
      type: Date,
      default: null,
    },
    tokens: [
      {
        token: {
          type: String,
          required: true,
        },
      },
    ],
    points: {
      type: Number,
      default: 0,
    },
    lastPointsUpdate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.methods.toJSON = function () {
  const user = this;
  const userObject = user.toObject();

  delete userObject.password;
  delete userObject.tokens;

  return userObject;
};

userSchema.methods.generateAuthToken = async function () {
  const user = this;
  const token = jwt.sign({ _id: user._id.toString() }, process.env.JWT_SECRET);

  user.tokens = user.tokens.concat({ token });
  await user.save();

  return token;
};

userSchema.statics.findByCredentials = async (email, password) => {
  const user = await User.findOne({ email });
  if (!user) {
    throw new Error("Unable to login");
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new Error("Unable to login");
  }

  return user;
};

userSchema.methods.addPoints = async function (date) {
  const startOfDay = moment(date).startOf("day").toDate();
  const endOfDay = moment(date).endOf("day").toDate();

  // Check if points have already been added for this day
  if (
    this.lastPointsUpdate &&
    this.lastPointsUpdate >= startOfDay &&
    this.lastPointsUpdate <= endOfDay
  ) {
    return;
  }

  const journal = await mongoose.model("Journal").findOne({
    user: this._id,
    date: { $gte: startOfDay, $lte: endOfDay },
  });

  if (journal) {
    let pointsToAdd = 0;
    if (journal.note) pointsToAdd++;
    if (journal.mistake) pointsToAdd++;
    if (journal.lesson) pointsToAdd++;
    if (journal.rulesFollowed.length > 0) pointsToAdd++;

    const trade = await mongoose.model("Trade").findOne({
      user: this._id,
      date: { $gte: startOfDay, $lte: endOfDay },
    });

    if (trade) pointsToAdd++;

    this.points += pointsToAdd;
    this.lastPointsUpdate = endOfDay;
    await this.save();
  }
};

userSchema.pre("save", async function (next) {
  const user = this;

  if (user.isModified("password")) {
    user.password = await bcrypt.hash(user.password, 8);
  }

  next();
});

const User = mongoose.model("User", userSchema);

module.exports = User;
