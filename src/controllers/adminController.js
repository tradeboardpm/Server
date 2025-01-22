const Admin = require("../models/Admin");
const User = require("../models/User");
const Trade = require("../models/Trade");
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
    // console.log(otp);
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


exports.listUsers = async (req, res) => {
  try {
    const users = await User.find({});
    res.status(200).send(users);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.editUser = async (req, res) => {
  const updates = Object.keys(req.body);
  const allowedUpdates = [
    "name",
    "email",
    "phone",
    "subscription",
    "subscriptionValidUntil",
    "capital",
    "points",
    "brokerage",
    "tradesPerDay",
  ];
  const isValidOperation = updates.every((update) =>
    allowedUpdates.includes(update)
  );

  if (!isValidOperation) {
    return res.status(400).send({ error: "Invalid updates!" });
  }

  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }

    updates.forEach((update) => (user[update] = req.body[update]));
    await user.save();

    res.send(user);
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

    // You might want to perform additional cleanup here, such as deleting associated trades

    res.send({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

