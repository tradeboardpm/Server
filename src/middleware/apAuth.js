const jwt = require("jsonwebtoken");
const AccountabilityPartner = require("../models/AccountabilityPartner");
const User = require("../models/User");

const apAuth = async (req, res, next) => {
  try {
    const token = req.header("Authorization").replace("Bearer ", "");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ _id: decoded.userId });

    if (!user) {
      throw new Error();
    }

    const accountabilityPartner = await AccountabilityPartner.findOne({
      _id: decoded.apId,
      user: user._id,
    });

    if (!accountabilityPartner) {
      throw new Error();
    }

    req.token = token;
    req.user = user;
    req.accountabilityPartner = accountabilityPartner;
    next();
  } catch (error) {
    res.status(401).send({ error: "Please authenticate." });
  }
};

module.exports = apAuth;
