// middleware/apAuth.js

const jwt = require("jsonwebtoken");
const AccountabilityPartner = require("../models/AccountabilityPartner");
const User = require("../models/User");

const apAuth = async (req, res, next) => {
  try {
    // Support both query param (?token=...) and Authorization header
    let token = req.query.token;

    if (!token) {
      const authHeader = req.header("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.replace("Bearer ", "");
      }
    }

    if (!token) {
      return res.status(401).json({ error: "Access denied. No token provided." });
    }

    // Verify token (no expiration check needed — we allow permanent tokens)
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find the partner must exist + be verified
    const partner = await AccountabilityPartner.findOne({
      _id: decoded.apId,
      user: decoded.userId,
      isVerified: true, // Critical: only verified partners can access
    }).populate("user");

    if (!partner) {
      return res.status(401).json({ error: "Invalid or unverified link. Please ask the trader to resend." });
    }

    // Attach to request
    req.accountabilityPartner = partner;
    req.user = partner.user; // the actual trader
    req.token = token;

    next();
    } catch (error) {
      console.error("AP Auth failed:", error.message);
      return res.status(401).json({ error: "Invalid or expired link." });
    }
  };
module.exports = apAuth;