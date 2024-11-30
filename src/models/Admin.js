const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const adminSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    otp: {
      code: String,
      expiresAt: Date,
    },
    adminType: {
      type: String,
      enum: ["super", "regular"],
      default: "regular",
    },
  },
  {
    timestamps: true,
  }
);

adminSchema.methods.generateOTP = async function () {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedOTP = await bcrypt.hash(otp, 8);
  this.otp = {
    code: hashedOTP,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // OTP expires in 10 minutes
  };
  await this.save();
  return otp;
};

adminSchema.methods.verifyOTP = async function (otp) {
  if (Date.now() > this.otp.expiresAt) {
    return false;
  }
  return await bcrypt.compare(otp, this.otp.code);
};

adminSchema.methods.generateAuthToken = async function () {
  const token = jwt.sign(
    { _id: this._id.toString(), isAdmin: true },
    process.env.JWT_SECRET
  );
  return token;
};

const Admin = mongoose.model("Admin", adminSchema);

module.exports = Admin;
