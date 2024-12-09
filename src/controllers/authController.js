const User = require("../models/User");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const emailService = require("../services/emailService");
const smsService = require("../services/smsService");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

exports.register = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    // Check if a user with the same email or phone exists but is not verified
    let existingUser = await User.findOne({
      $or: [
        { email: email.trim().toLowerCase(), isEmailVerified: false },
        { phone, isPhoneVerified: false },
      ],
    });

    if (existingUser) {
      // If user exists but not verified, update their information
      existingUser.name = name;
      existingUser.email = email.trim().toLowerCase();
      existingUser.password = password;
      existingUser.phone = phone;
    } else {
      // If no existing unverified user, create a new one
      existingUser = new User({
        name,
        email: email.trim().toLowerCase(),
        password,
        phone,
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    existingUser.otp = otp;
    existingUser.otpExpires = Date.now() + 10 * 60 * 1000; // OTP expires in 10 minutes
    await existingUser.save();

    console.log(`Generated OTP for ${email}: ${otp}`);

    try {
      await emailService.sendOTP(email, otp, name, "registration");
    } catch (emailError) {
      console.error("Failed to send OTP via email:", emailError);
    }

    if (phone) {
      try {
        await smsService.sendOTP(phone);
      } catch (smsError) {
        console.error("Failed to send OTP via SMS:", smsError);
      }
    }

    res.status(201).json({ message: "User registered. Please verify OTP." });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.verifyEmailOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    console.log("Received verification request:", { email, otp });

    const sanitizedOTP = otp.toString().trim();
    const sanitizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: sanitizedEmail,
      otp: sanitizedOTP,
      otpExpires: { $gt: Date.now() },
    });

    console.log("Found user:", user);

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    user.isEmailVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    const token = await user.generateAuthToken();
    res.status(200).json({
      token,
      expiresIn: 86400, // 24 hours in seconds
      user: user.toJSON(),
      message: "Email verified successfully",
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.loginEmail = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findByCredentials(email.trim().toLowerCase(), password);
    if (!user.isEmailVerified) {
      return res.status(401).json({ error: "Please verify your email account" });
    }
    const token = await user.generateAuthToken();
    res.status(200).json({
      token,
      expiresIn: 86400, // 24 hours in seconds
      user: user.toJSON(),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.loginPhone = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      });
    }

    const phoneRegex = /^\+?[\d\s-]{10,}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        success: false,
        error: "Invalid phone number format",
      });
    }

    let user = await User.findOne({ phone });
    if (!user) {
      user = new User({
        phone,
        isPhoneVerified: false,
      });
      await user.save();
    }

    try {
      await smsService.sendOTP(phone);
      return res.status(200).json({
        success: true,
        message: "OTP sent successfully",
        phone: phone,
      });
    } catch (smsError) {
      console.error("SMS sending failed:", smsError);
      return res.status(500).json({
        success: false,
        error: "Failed to send OTP. Please try again.",
      });
    }
  } catch (error) {
    console.error("Login phone error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

exports.verifyPhoneOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: "Phone number and OTP are required" });
    }

    try {
      const verificationResult = await smsService.verifyOTP(phone, otp);
      if (!verificationResult.success) {
        return res.status(400).json({ error: verificationResult.message });
      }
    } catch (error) {
      console.error("OTP verification failed:", error.message);
      return res.status(500).json({
        success: false,
        error: "Failed to verify OTP. Please try again.",
      });
    }

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.isPhoneVerified = true;
    await user.save();

    const token = await user.generateAuthToken();

    res.status(200).json({
      success: true,
      token,
      expiresIn: 86400, // 24 hours in seconds
      user: user.toJSON(),
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

exports.googleLogin = async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { name, email, sub: googleId } = ticket.getPayload();
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        name,
        email,
        googleId,
        password: Math.random().toString(36).slice(-8),
        isEmailVerified: true,
      });
    } else if (!user.googleId) {
      user.googleId = googleId;
      await user.save();
    }
    const jwtToken = await user.generateAuthToken();
    res.status(200).json({
      token: jwtToken,
      expiresIn: 86400, // 24 hours in seconds
      user: user.toJSON(),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.googleSignup = async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { name, email, sub: googleId } = ticket.getPayload();

    let user = await User.findOne({ email });
    if (user) {
      // If user exists, update their Google ID if not set
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
    } else {
      // If user doesn't exist, create a new user
      user = new User({
        name,
        email,
        googleId,
        password: Math.random().toString(36).slice(-8), // Generate a random password
        isEmailVerified: true, // Google accounts are considered verified
      });
      await user.save();
    }

    const authToken = await user.generateAuthToken();
    res.status(200).json({
      token: authToken,
      expiresIn: 86400, // 24 hours in seconds
      user: user.toJSON(),
    });
  } catch (error) {
    console.error("Google signup error:", error);
    res.status(400).json({ error: error.message });
  }
};



exports.resendEmailOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.trim().toLowerCase() });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = Date.now() + 10 * 60 * 1000;
    await user.save();

    console.log(`Regenerated OTP for ${email}: ${otp}`);

    await emailService.sendOTP(email, otp, user.name, "resend");

    res.status(200).json({ message: "New OTP sent successfully" });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.resendPhoneOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    try {
      await smsService.sendOTP(phone);
      return res.status(200).json({ message: "New OTP sent successfully" });
    } catch (error) {
      console.error("Failed to resend OTP:", error.message);
      return res.status(500).json({
        error: "Failed to resend OTP. Please try again.",
      });
    }
  } catch (error) {
    console.error("Resend phone OTP error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.trim().toLowerCase() });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPasswordOTP = otp;
    user.resetPasswordOTPExpires = Date.now() + 10 * 60 * 1000; // OTP expires in 10 minutes
    await user.save();

    console.log(`Generated reset password OTP for ${email}: ${otp}`);

    await emailService.sendOTP(email, otp, user.name, "resetPassword");

    res.status(200).json({ message: "Reset password OTP sent successfully" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.verifyForgotPasswordOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({
      email: email.trim().toLowerCase(),
      resetPasswordOTP: otp,
      resetPasswordOTPExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    const resetToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "15m", // Token expires in 15 minutes
    });

    res.status(200).json({
      message: "OTP verified successfully",
      resetToken,
    });
  } catch (error) {
    console.error("Verify forgot password OTP error:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    const decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(400).json({ error: "Invalid reset token" });
    }

    user.password = newPassword;
    user.resetPasswordOTP = undefined;
    user.resetPasswordOTPExpires = undefined;
    await user.save();

    res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.logout = async (req, res) => {
  try {
    req.user.tokens = req.user.tokens.filter((token) => {
      return token.token !== req.token;
    });
    await req.user.save();
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ error: "Server error during logout" });
  }
};

exports.logoutAll = async (req, res) => {
  try {
    req.user.tokens = [];
    await req.user.save();
    res.status(200).json({ message: "Logged out from all devices successfully" });
  } catch (error) {
    res.status(500).json({ error: "Server error during logout from all devices" });
  }
};

module.exports = exports;