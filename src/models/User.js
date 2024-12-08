const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const moment = require("moment");
const jwt = require("jsonwebtoken");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
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
    phone: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
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
    capital: {
      type: Number,
      default: 100000, // Default initial capital
    },
    capitalHistory: [
      {
        date: Date,
        amount: Number,
      },
    ],
    otp: String,
    otpExpires: Date,
    resetPasswordOTP: String,
    resetPasswordOTPExpires: Date,
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
    brokerage: {
      type: Number,
      default: 25,
      min: 0,
    },
    tradesPerDay: {
      type: Number,
      default: 4,
      min: 0,
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
  delete userObject.otp;
  delete userObject.otpExpires;
  delete userObject.resetPasswordOTP;
  delete userObject.resetPasswordOTPExpires;

  return userObject;
};

userSchema.methods.updateCapital = async function (
  amount,
  date = moment.utc().toDate()
) {
  this.capital += amount;
  this.capitalHistory.push({ date, amount: this.capital });
  await this.save();
};

userSchema.methods.generateAuthToken = async function () {
  const user = this;
  const token = jwt.sign({ _id: user._id.toString() }, process.env.JWT_SECRET, {
    expiresIn: "24h",
  });

  user.tokens = user.tokens.concat({ token });
  await user.save();

  return token;
};

userSchema.methods.comparePassword = async function (password) {
  const user = this;
  return bcrypt.compare(password, user.password);
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

userSchema.pre("save", async function (next) {
  const user = this;

  if (user.isModified("password")) {
    user.password = await bcrypt.hash(user.password, 8);
  }

  next();
});

const User = mongoose.model("User", userSchema);

module.exports = User;
