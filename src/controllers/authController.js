const User = require("../models/User")
const jwt = require("jsonwebtoken")
const { OAuth2Client } = require("google-auth-library")
const emailService = require("../services/emailService")
const smsService = require("../services/smsService")

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

exports.validateToken = async (req, res) => {
  try {
    // If the middleware passes, the token is valid
    res.status(200).json({ valid: true })
  } catch (error) {
    console.error("Token validation error:", error)
    res.status(401).json({ valid: false, error: "Invalid token" })
  }
}

exports.register = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    // Check if a user with the same email or phone exists
    let existingUser = await User.findOne({
      $or: [{ email: email.trim().toLowerCase() }, { phone }],
    });

    if (existingUser) {
      // If user exists and is verified, don't allow registration
      if (existingUser.isEmailVerified || existingUser.isPhoneVerified) {
        return res.status(400).json({ error: "User already exists and is verified" });
      }

      // If user exists but not verified, update their information
      existingUser.name = name;
      existingUser.email = email.trim().toLowerCase();
      existingUser.password = password;
      existingUser.phone = phone;
    } else {
      // If no existing user, create a new one
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

    // Send OTP via email
    try {
      await emailService.sendOTP(email, otp, name, "registration");
    } catch (emailError) {
      console.error("Failed to send OTP via email:", emailError);
    }

    // Send welcome email to the new user
    try {
      await emailService.sendWelcomeEmail(email, name);
    } catch (emailError) {
      console.error("Failed to send welcome email:", emailError);
    }

    // Send OTP via SMS if phone is provided
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
    const { email, otp } = req.body
    // console.log("Received verification request:", { email, otp });

    const sanitizedOTP = otp.toString().trim()
    const sanitizedEmail = email.trim().toLowerCase()

    const user = await User.findOne({
      email: sanitizedEmail,
      otp: sanitizedOTP,
      otpExpires: { $gt: Date.now() },
    })

    // console.log("Found user:", user);

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired OTP" })
    }

    user.isEmailVerified = true
    user.otp = undefined
    user.otpExpires = undefined
    await user.save()

    const token = await user.generateAuthToken()
    res.status(200).json({
      token,
      expiresIn: 86400, // 24 hours in seconds
      user: user.toJSON(),
      message: "Email verified successfully",
    })
  } catch (error) {
    console.error("OTP verification error:", error)
    res.status(400).json({ error: error.message })
  }
}

exports.loginEmail = async (req, res) => {
  try {
    const { email, password } = req.body
    const user = await User.findOne({ email: email.trim().toLowerCase() })

    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" })
    }

    if (!user.isEmailVerified) {
      return res.status(401).json({ error: "Please verify your email account" })
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" })
    }

    const token = await user.generateAuthToken()
    res.status(200).json({
      token,
      expiresIn: 86400, // 24 hours in seconds
      user: user.toJSON(),
    })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({ error: "Internal server error" })
  }
}

exports.loginPhone = async (req, res) => {
  try {
    const { phone } = req.body

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      })
    }

    const phoneRegex = /^\+?[\d\s-]{10,}$/
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        success: false,
        error: "Invalid phone number format",
      })
    }

    let user = await User.findOne({ phone })
    if (!user) {
      user = new User({
        phone,
        isPhoneVerified: false,
      })
      await user.save()
    }

    try {
      await smsService.sendOTP(phone)
      return res.status(200).json({
        success: true,
        message: "OTP sent successfully",
        phone: phone,
      })
    } catch (smsError) {
      console.error("SMS sending failed:", smsError)
      return res.status(500).json({
        success: false,
        error: "Failed to send OTP. Please try again.",
      })
    }
  } catch (error) {
    console.error("Login phone error:", error)
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    })
  }
}

exports.verifyPhoneOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body

    if (!phone || !otp) {
      return res.status(400).json({ error: "Phone number and OTP are required" })
    }

    try {
      const verificationResult = await smsService.verifyOTP(phone, otp)
      if (!verificationResult.success) {
        return res.status(400).json({ error: verificationResult.message })
      }
    } catch (error) {
      console.error("OTP verification failed:", error.message)
      return res.status(500).json({
        success: false,
        error: "Failed to verify OTP. Please try again.",
      })
    }

    const user = await User.findOne({ phone })
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    user.isPhoneVerified = true
    await user.save()

    const token = await user.generateAuthToken()

    res.status(200).json({
      success: true,
      token,
      expiresIn: 86400, // 24 hours in seconds
      user: user.toJSON(),
    })
  } catch (error) {
    console.error("OTP verification error:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}

exports.googleLogin = async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { name, email, sub: googleId } = ticket.getPayload();
    let user = await User.findOne({ email });

    let isNewUser = false; // Flag to track if this is a new signup

    if (!user) {
      // New user: create account and set isFirstTimeLogin to true
      user = await User.create({
        name,
        email,
        googleId,
        googlePassword: Math.random().toString(36).slice(-8),
        isEmailVerified: true,
        isFirstTimeLogin: true, // Set for new user
      });
      isNewUser = true;

      try {
        await emailService.sendWelcomeEmail(email, name);
      } catch (emailError) {
        console.error("Failed to send welcome email:", emailError);
      }
    } else {
      // Existing user: ensure googleId is linked and update isFirstTimeLogin if needed
      if (!user.googleId) {
        user.googleId = googleId;
        user.googlePassword = Math.random().toString(36).slice(-8);
      }
      user.isEmailVerified = true;
      if (user.isFirstTimeLogin === undefined) {
        user.isFirstTimeLogin = false; // Set to false for existing users
      }
      await user.save();
    }

    const jwtToken = await user.generateAuthToken();
    res.status(200).json({
      token: jwtToken,
      expiresIn: 86400,
      user: user.toJSON(),
      isNewUser, // Include this in the response
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
    let isNewUser = false; // Flag to track if this is a new signup

    if (user) {
      // Existing user: link Google ID if not already linked
      if (!user.googleId) {
        user.googleId = googleId;
        user.googlePassword = Math.random().toString(36).slice(-8);
      }
      user.isEmailVerified = true;
      if (user.isFirstTimeLogin === undefined) {
        user.isFirstTimeLogin = false; // Set to false for existing users
      }
      await user.save();
    } else {
      // New user: create account and set isFirstTimeLogin to true
      user = new User({
        name,
        email,
        googleId,
        googlePassword: Math.random().toString(36).slice(-8),
        isEmailVerified: true,
        isFirstTimeLogin: true, // Set for new user
      });
      await user.save();
      isNewUser = true;

      try {
        await emailService.sendWelcomeEmail(email, name);
      } catch (emailError) {
        console.error("Failed to send welcome email:", emailError);
      }
    }

    const authToken = await user.generateAuthToken();
    res.status(200).json({
      token: authToken,
      expiresIn: 86400,
      user: user.toJSON(),
      isNewUser, // Include this in the response
    });
  } catch (error) {
    console.error("Google signup error:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.resendEmailOTP = async (req, res) => {
  try {
    const { email, purpose = "registration" } = req.body // Add purpose parameter
    const user = await User.findOne({ email: email.trim().toLowerCase() })

    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    user.otp = otp
    user.otpExpires = Date.now() + 10 * 60 * 1000
    user.otpPurpose = purpose // Set the purpose
    await user.save()

    // console.log(`Regenerated OTP for ${email}: ${otp}`);

    await emailService.sendOTP(email, otp, user.name, purpose)

    res.status(200).json({ message: "New OTP sent successfully" })
  } catch (error) {
    console.error("Resend OTP error:", error)
    res.status(400).json({ error: error.message })
  }
}

exports.resendPhoneOTP = async (req, res) => {
  try {
    const { phone } = req.body

    const user = await User.findOne({ phone })
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    try {
      await smsService.sendOTP(phone)
      return res.status(200).json({ message: "New OTP sent successfully" })
    } catch (error) {
      console.error("Failed to resend OTP:", error.message)
      return res.status(500).json({
        error: "Failed to resend OTP. Please try again.",
      })
    }
  } catch (error) {
    console.error("Resend phone OTP error:", error)
    res.status(500).json({ error: "Internal server error" })
  }
}

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.trim().toLowerCase() });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = Date.now() + 10 * 60 * 1000; // OTP expires in 10 minutes
    user.otpPurpose = "resetPassword";
    await user.save();

    // console.log(`Generated reset password OTP for ${email}:`, {
    //   otp,
    //   expires: user.otpExpires,
    //   purpose: user.otpPurpose
    // });

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
    const sanitizedOTP = otp.toString().trim();
    const sanitizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: sanitizedEmail });
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    if (
      user.otp !== sanitizedOTP ||
      user.otpExpires <= Date.now() ||
      user.otpPurpose !== "resetPassword"
    ) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    const resetToken = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    console.log("--- verifyForgotPasswordOTP ---");
    console.log("User ID:", user._id.toString());
    console.log("Email:", sanitizedEmail);
    console.log("Generated resetToken:", resetToken);

    user.otp = undefined;
    user.otpExpires = undefined;
    user.otpPurpose = undefined;
    await user.save();

    res.status(200).json({
      message: "OTP verified successfully",
      resetToken, // Changed from "token" to "resetToken"
      email: sanitizedEmail,
    });
  } catch (error) {
    console.error("Verify forgot password OTP error:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword, email } = req.body;

    console.log("--- resetPassword ---");
    console.log("Received resetToken:", resetToken);
    console.log("Received email:", email);
    console.log("JWT_SECRET:", process.env.JWT_SECRET);

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
      console.log("Decoded token:", decoded);
    } catch (err) {
      console.error("Token verification failed:", err.message);
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    // Find user by email
    const sanitizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: sanitizedEmail });
    if (!user) {
      console.log("User not found for email:", sanitizedEmail);
      return res.status(400).json({ error: "User not found" });
    }

    // Verify the user ID from token matches the found user
    if (user._id.toString() !== decoded.userId) {
      console.log("Token userId mismatch:", {
        tokenUserId: decoded.userId,
        dbUserId: user._id.toString(),
      });
      return res.status(400).json({ error: "Invalid reset token for this user" });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    console.log("Password reset successful for user:", user._id.toString());
    res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.logout = async (req, res) => {
  try {
    req.user.tokens = req.user.tokens.filter((token) => {
      return token.token !== req.token
    })
    await req.user.save()
    res.status(200).json({ message: "Logged out successfully" })
  } catch (error) {
    res.status(500).json({ error: "Server error during logout" })
  }
}

exports.logoutAll = async (req, res) => {
  try {
    req.user.tokens = []
    await req.user.save()
    res.status(200).json({ message: "Logged out from all devices successfully" })
  } catch (error) {
    res.status(500).json({ error: "Server error during logout from all devices" })
  }
}

// New function to delete account
exports.deleteAccount = async (req, res) => {
  try {
    const user = req.user // Assuming you have authentication middleware that sets req.user

    // Delete the user
    await User.findByIdAndDelete(user._id)

    res.status(200).json({ message: "Account deleted successfully" })
  } catch (error) {
    console.error("Delete account error:", error)
    res.status(500).json({ error: "Internal server error" })
  }
}

module.exports = exports

