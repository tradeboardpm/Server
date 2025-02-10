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
      required: function () {
        return !this.googleId
      },
      minlength: 7,
      trim: true,
    },
    googlePassword: {
      type: String,
      required: function () {
        return !!this.googleId;
      },
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
    otpPurpose: String,
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
    pointsHistory: [
      {
        date: Date,
        pointsChange: Number, // +1 or -1
      },
    ],
    tradePointsHistory: [{
      date: { type: Date, required: true },
      pointsChange: { type: Number, required: true }
    }],
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
  delete userObject.googlePassword;
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
  if (this.password) {
    return bcrypt.compare(password, this.password);
  } else if (this.googlePassword) {
    return bcrypt.compare(password, this.googlePassword);
  }
  return false;
};

userSchema.statics.findByCredentials = async (email, password) => {
  const user = await User.findOne({ email });
  if (!user) {
    throw new Error("Unable to login");
  }

  const isMatch = await bcrypt.compare(
    password,
    user.password || user.googlePassword
  );
  if (!isMatch) {
    throw new Error("Unable to login");
  }

  return user;
};

userSchema.pre("save", async function (next) {
  const user = this;

  if (user.isModified("password") && user.password) {
    user.password = await bcrypt.hash(user.password, 8);
  }

  if (user.isModified("googlePassword") && user.googlePassword) {
    user.googlePassword = await bcrypt.hash(user.googlePassword, 8);
  }

  next();
});

const User = mongoose.model("User", userSchema);

module.exports = User;
