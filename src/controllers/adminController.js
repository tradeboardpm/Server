const Admin = require("../models/Admin");
const User = require("../models/User");
const Trade = require("../models/Trade");
const ChargeRates = require("../models/ChargeRates");
const emailService = require("../services/emailService");
const moment = require("moment");

exports.login = async (req, res) => {
  try {
    const { email } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(404).send({ error: "Admin not found" });
    }
      const otp = await admin.generateOTP();
      console.log(otp)
    await emailService.sendAdminOTP(admin.email, otp);
    res.status(200).send({ message: "OTP sent to your email" });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(404).send({ error: "Admin not found" });
    }
    const isValid = await admin.verifyOTP(otp);
    if (!isValid) {
      return res.status(400).send({ error: "Invalid or expired OTP" });
    }
    const token = await admin.generateAuthToken();
    res.status(200).send({ admin, token });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.listUsers = async (req, res) => {
  try {
    const { sort, order } = req.query;
    let sortOption = {};
    if (sort === "subscriptionDate")
      sortOption = { "subscription.startDate": order === "desc" ? -1 : 1 };
    else if (sort === "subscriptionExpiration")
      sortOption = { "subscription.endDate": order === "desc" ? -1 : 1 };
    else if (sort === "createdAt")
      sortOption = { createdAt: order === "desc" ? -1 : 1 };
    else if (sort === "points")
      sortOption = { points: order === "desc" ? -1 : 1 };

    const users = await User.find({}, "-password").sort(sortOption);
    res.status(200).send(users);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.findUser = async (req, res) => {
  try {
    const { query } = req.params;
    const user = await User.findOne(
      {
        $or: [{ email: query }, { username: query }],
      },
      "-password"
    );
    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }
    res.status(200).send(user);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.editUser = async (req, res) => {
  try {
    const updates = Object.keys(req.body);
    const allowedUpdates = ["username", "email", "subscription"];
    const isValidOperation = updates.every((update) =>
      allowedUpdates.includes(update)
    );

    if (!isValidOperation) {
      return res.status(400).send({ error: "Invalid updates!" });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }

    updates.forEach((update) => (user[update] = req.body[update]));
    await user.save();
    res.status(200).send(user);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }
    res.status(200).send({ message: "User deleted successfully" });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.getStats = async (req, res) => {
  try {
    const now = moment();
    const startOfMonth = now.clone().startOf("month");

    const usersThisMonth = await User.countDocuments({
      createdAt: { $gte: startOfMonth.toDate() },
    });

    const totalUsers = await User.countDocuments();
    const totalTrades = await Trade.countDocuments();
    const avgTradesPerUser = totalUsers > 0 ? totalTrades / totalUsers : 0;

    const activeUsers = await User.countDocuments({
      "subscription.endDate": { $gt: now.toDate() },
    });

    res.status(200).send({
      usersRegisteredThisMonth: usersThisMonth,
      avgTradesPerUser,
      totalUsers,
      activeUsers,
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.createAdmin = async (req, res) => {
  try {
    const { username, email } = req.body;
    const admin = new Admin({ username, email });
    await admin.save();
    res.status(201).send({ message: "New admin created successfully", admin });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.getChargeRates = async (req, res) => {
  try {
    const chargeRates = await ChargeRates.findOne().sort({ createdAt: -1 });
    if (!chargeRates) {
      return res.status(404).send({ error: "Charge rates not found" });
    }
    res.status(200).send(chargeRates);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.deleteAdmin = async (req, res) => {
  try {
    const admin = await Admin.findByIdAndDelete(req.params.id);
    if (!admin) {
      return res.status(404).send({ error: "Admin not found" });
    }
    res.status(200).send({ message: "Admin deleted successfully" });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.listAdmins = async (req, res) => {
  try {
    const admins = await Admin.find({}, "-otp");
    res.status(200).send(admins);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.updateChargeRates = async (req, res) => {
  try {
    const updates = Object.keys(req.body);
    const chargeRates = await ChargeRates.findOne();
    if (!chargeRates) {
      return res.status(404).send({ error: "Charge rates not found" });
    }

    updates.forEach((update) => (chargeRates[update] = req.body[update]));
    chargeRates.lastChangedBy = req.admin._id;
    await chargeRates.save();
    res.status(200).send(chargeRates);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.resetChargeRates = async (req, res) => {
  try {
    const defaultChargeRates = new ChargeRates();
    defaultChargeRates.lastChangedBy = req.admin._id;
    await ChargeRates.deleteMany({});
    await defaultChargeRates.save();
    res
      .status(200)
      .send({
        message: "Charge rates reset to default",
        chargeRates: defaultChargeRates,
      });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
