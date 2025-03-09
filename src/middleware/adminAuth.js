const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

const adminAuth = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ success: false, error: "Authentication token missing" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded._id);

    if (!admin) {
      return res.status(401).json({ success: false, error: "Admin not found" });
    }

    req.user = admin;
    req.user.isAdmin = true; // Assuming you use this to verify admin status
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: "Invalid token or unauthorized" });
  }
};

module.exports = adminAuth;