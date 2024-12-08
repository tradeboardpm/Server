const User = require("../models/User");
const Announcement = require("../models/Announcement");
const moment = require("moment");


exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.send({
      name: user.name,
      email: user.email,
      phone: user.phone || null,
    });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const user = await User.findById(req.user._id);

    // Validate email if provided
    if (email) {
      // Check if email is already in use by another user
      const existingEmailUser = await User.findOne({
        email,
        _id: { $ne: user._id },
      });

      if (existingEmailUser) {
        return res.status(400).send({ error: "Email already in use" });
      }

      user.email = email;
    }

    // Update name if provided
    if (name) {
      user.name = name;
    }

    // Update phone if provided
    if (phone) {
      // Check if phone is already in use by another user
      const existingPhoneUser = await User.findOne({
        phone,
        _id: { $ne: user._id },
      });

      if (existingPhoneUser) {
        return res.status(400).send({ error: "Phone number already in use" });
      }

      user.phone = phone;
    }

    await user.save();

    res.send({
      name: user.name,
      email: user.email,
      phone: user.phone || null,
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .send({ error: "Current and new passwords are required" });
    }

    // Find the user
    const user = await User.findById(req.user._id);

    // Check if current password is correct
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).send({ error: "Current password is incorrect" });
    }

    // Validate new password (e.g., minimum length)
    if (newPassword.length < 7) {
      return res
        .status(400)
        .send({ error: "New password must be at least 7 characters long" });
    }

    // Set the new password
    user.password = newPassword;
    await user.save();

    res.send({ message: "Password updated successfully" });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.getUserSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.send({
      capital: user.capital,
      brokerage: user.brokerage,
      tradesPerDay: user.tradesPerDay,
      points: user.points,
    });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.updateUserSettings = async (req, res) => {
  try {
    const { capital, brokerage, tradesPerDay } = req.body;
    const user = await User.findById(req.user._id);

    // Update capital with history tracking
    if (capital !== undefined) {
      const amount = capital - user.capital;
      await user.updateCapital(amount, moment.utc().toDate());
    }

    // Update brokerage if provided
    if (brokerage !== undefined) {
      user.brokerage = brokerage;
    }

    // Update trades per day if provided
    if (tradesPerDay !== undefined) {
      user.tradesPerDay = tradesPerDay;
    }

    await user.save();

    res.send({
      capital: user.capital,
      brokerage: user.brokerage,
      tradesPerDay: user.tradesPerDay,
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.getCapital = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.send({ capital: user.capital });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.updateCapital = async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.user._id);
    await user.updateCapital(amount, moment.utc().toDate());
    res.send({ capital: user.capital });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.getCapitalByMonthYear = async (req, res) => {
  try {
    const { month, year } = req.query;
    if (!month || !year) {
      return res.status(400).send({ error: "Month and year are required" });
    }

    const user = await User.findById(req.user._id);
    const startDate = moment.utc(`${year}-${month}-01`).startOf("month");
    const endDate = moment.utc(startDate).endOf("month");

    const capitalEntry = user.capitalHistory
      .filter((entry) =>
        moment.utc(entry.date).isBetween(startDate, endDate, null, "[]")
      )
      .sort((a, b) => b.date - a.date)[0];

    if (!capitalEntry) {
      return res
        .status(404)
        .send({
          error: "No capital data found for the specified month and year",
        });
    }

    res.send({ capital: capitalEntry.amount, date: capitalEntry.date });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.getActiveAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find({ isActive: true }).sort({
      createdAt: -1,
    });

    res.status(200).send(announcements);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

