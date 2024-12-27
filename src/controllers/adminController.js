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
    console.log(otp);
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
    const {
      sort,
      order,
      subscription,
      minPoints,
      maxPoints,
      minCapital,
      maxCapital,
      search,
      isEmailVerified,
      isPhoneVerified,
    } = req.query;

    // Build filter object
    const filter = {};

    // Subscription filter
    if (subscription) {
      filter.subscription = subscription;
    }

    // Points range filter
    if (minPoints !== undefined || maxPoints !== undefined) {
      filter.points = {};
      if (minPoints !== undefined) filter.points.$gte = Number(minPoints);
      if (maxPoints !== undefined) filter.points.$lte = Number(maxPoints);
    }

    // Capital range filter
    if (minCapital !== undefined || maxCapital !== undefined) {
      filter.capital = {};
      if (minCapital !== undefined) filter.capital.$gte = Number(minCapital);
      if (maxCapital !== undefined) filter.capital.$lte = Number(maxCapital);
    }

    // Search filter (across multiple fields)
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    // Email and phone verification filters
    if (isEmailVerified !== undefined) {
      filter.isEmailVerified = isEmailVerified === "true";
    }

    if (isPhoneVerified !== undefined) {
      filter.isPhoneVerified = isPhoneVerified === "true";
    }

    // Sort options
    let sortOption = {};
    if (sort === "subscriptionDate")
      sortOption = { subscriptionValidUntil: order === "desc" ? -1 : 1 };
    else if (sort === "createdAt")
      sortOption = { createdAt: order === "desc" ? -1 : 1 };
    else if (sort === "points")
      sortOption = { points: order === "desc" ? -1 : 1 };
    else if (sort === "capital")
      sortOption = { capital: order === "desc" ? -1 : 1 };

    const selectedFields =
      "_id name email phone isEmailVerified isPhoneVerified " +
      "subscription subscriptionValidUntil points capital brokerage tradesPerDay";

    const users = await User.find(filter, selectedFields).sort(sortOption);

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
    const allowedUpdates = [
      "name",
      "email",
      "phone",
      "isEmailVerified",
      "isPhoneVerified",
      "subscription",
      "subscriptionValidUntil",
      "points",
      "capital",
      "brokerage",
      "tradesPerDay",
    ];
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

    // Calculate average brokerage and trades per day
    const userStats = await User.aggregate([
      {
        $group: {
          _id: null,
          avgBrokerage: { $avg: "$brokerage" },
          avgTradesPerDay: { $avg: "$tradesPerDay" },
        },
      },
    ]);

    const avgBrokerage = userStats[0]?.avgBrokerage || 0;
    const avgTradesPerDay = userStats[0]?.avgTradesPerDay || 0;

    res.status(200).send({
      usersRegisteredThisMonth: usersThisMonth,
      avgTradesPerUser,
      totalUsers,
      activeUsers,
      avgBrokerage,
      avgTradesPerDay,
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

exports.updateCharges = async (req, res) => {
  try {
    const { userId } = req.params;
    const { brokerage, tradesPerDay } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }

    if (brokerage !== undefined) user.brokerage = brokerage;
    if (tradesPerDay !== undefined) user.tradesPerDay = tradesPerDay;

    await user.save();
    res.status(200).send(user);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.resetCharges = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }

    user.brokerage = 25; // Reset to default value
    user.tradesPerDay = 4; // Reset to default value

    await user.save();
    res.status(200).send({
      message: "Charges reset to default",
      user,
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};
