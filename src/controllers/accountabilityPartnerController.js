const AccountabilityPartner = require("../models/AccountabilityPartner");
const User = require("../models/User");
const Capital = require("../models/Capital");
const Trade = require("../models/Trade");
const Journal = require("../models/Journal");
const nodemailer = require("nodemailer");
const emailService = require("../services/emailService");
const moment = require("moment");
// const { getDateRangeMetrics } = require("./metricsController");
const { calculateDateRangeMetrics } = require("./metricsController");

exports.addAccountabilityPartner = async (req, res) => {
  try {
    const { name, email, relation, dataToShare, shareFrequency } = req.body;

    // Check if the user has reached the limit of 5 APs
    const existingPartnersCount = await AccountabilityPartner.countDocuments({
      user: req.user._id,
    });
    if (existingPartnersCount >= 5) {
      return res
        .status(400)
        .send({
          error:
            "You have reached the maximum limit of 5 accountability partners.",
        });
    }

    // Check if the email is already in use for this user
    const existingPartner = await AccountabilityPartner.findOne({
      user: req.user._id,
      email,
    });
    if (existingPartner) {
      return res
        .status(400)
        .send({
          error: "An accountability partner with this email already exists.",
        });
    }

    const accountabilityPartner = new AccountabilityPartner({
      user: req.user._id,
      name,
      email,
      relation,
      dataToShare,
      shareFrequency,
    });
    await accountabilityPartner.save();

    // Send email to the new accountability partner
    await emailService.sendNewPartnerEmail(req.user, accountabilityPartner);

    res.status(201).send(accountabilityPartner);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.getAccountabilityPartners = async (req, res) => {
  try {
    const accountabilityPartners = await AccountabilityPartner.find({
      user: req.user._id,
    });
    res.send(accountabilityPartners);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.updateAccountabilityPartner = async (req, res) => {
  try {
    const updates = Object.keys(req.body);
    const allowedUpdates = [
      "name",
      "email",
      "relation",
      "dataToShare",
      "shareFrequency",
    ];
    const isValidOperation = updates.every((update) =>
      allowedUpdates.includes(update)
    );

    if (!isValidOperation) {
      return res.status(400).send({ error: "Invalid updates!" });
    }

    const accountabilityPartner = await AccountabilityPartner.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!accountabilityPartner) {
      return res
        .status(404)
        .send({ error: "Accountability partner not found" });
    }

    updates.forEach(
      (update) => (accountabilityPartner[update] = req.body[update])
    );
    await accountabilityPartner.save();
    res.send(accountabilityPartner);
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
};

exports.deleteAccountabilityPartner = async (req, res) => {
  try {
    const accountabilityPartner = await AccountabilityPartner.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!accountabilityPartner) {
      return res
        .status(404)
        .send({ error: "Accountability partner not found" });
    }

    res.send(accountabilityPartner);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

exports.getSharedData = async (req, res) => {
  try {
    const { partnerId, date } = req.query;
    const accountabilityPartner = await AccountabilityPartner.findOne({
      _id: partnerId,
      user: req.user._id,
    });

    if (!accountabilityPartner) {
      return res
        .status(404)
        .send({ error: "Accountability partner not found" });
    }

    const sharedData = await generateSharedData(
      req.user._id,
      accountabilityPartner.dataToShare,
      date
    );
    res.send(sharedData);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

async function generateSharedData(userId, dataToShare, date) {
  const user = await User.findById(userId);
  const endDate = moment(date).endOf("day").toDate();
  const startDate = moment(endDate)
    .subtract(1, dataToShare.shareFrequency === "weekly" ? "week" : "month")
    .startOf("day")
    .toDate();

  let sharedData = {};

  if (dataToShare.capital) {
    const capital = await Capital.findOne({
      user: userId,
      date: { $lte: endDate },
    }).sort({ date: -1 });
    sharedData.capital = capital ? capital.amount : 0;
  }

  if (dataToShare.currentPoints) {
    sharedData.currentPoints = user.points;
  }

  const trades = await Trade.find({
    user: userId,
    date: { $gte: startDate, $lte: endDate },
  });
  const journals = await Journal.find({
    user: userId,
    date: { $gte: startDate, $lte: endDate },
  });

  if (dataToShare.rulesFollowed) {
    sharedData.rulesFollowed = journals.reduce(
      (sum, journal) => sum + journal.rulesFollowed.length,
      0
    );
  }

  if (
    dataToShare.winRate ||
    dataToShare.tradesTaken ||
    dataToShare.profitLoss
  ) {
    const winningTrades = trades.filter((trade) => trade.netPnL > 0);
    sharedData.winRate =
      trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    sharedData.tradesTaken = trades.length;
    sharedData.profitLoss = trades.reduce(
      (sum, trade) => sum + trade.netPnL,
      0
    );
  }

  if (dataToShare.dateRangeMetrics) {
    // Reuse the logic from metricsController.getDateRangeMetrics
    // You may need to refactor that function to make it reusable here
sharedData.dateRangeMetrics = await calculateDateRangeMetrics(
  userId,
  startDate,
  endDate
);
  }

  return sharedData;
}

async function sendAccountabilityEmail(accountabilityPartner) {
  const sharedData = await generateSharedData(
    accountabilityPartner.user,
    accountabilityPartner.dataToShare,
    new Date()
  );

  await emailService.sendAccountabilityUpdate(
    accountabilityPartner,
    sharedData
  );
  accountabilityPartner.sharedDates.push(new Date());
  await accountabilityPartner.save();
}

// async function sendNewPartnerEmail(user, accountabilityPartner) {
//   const mailOptions = {
//     from: process.env.EMAIL_USER,
//     to: accountabilityPartner.email,
//     subject: "You have been added as an Accountability Partner",
//     html: `
//       <h1>Welcome as an Accountability Partner</h1>
//       <p>Hello ${accountabilityPartner.name},</p>
//       <p>You have been added as an accountability partner for ${user.username} in their trading journey.</p>
//       <p>You will receive ${accountabilityPartner.shareFrequency} updates on their trading performance.</p>
//       <p>Thank you for your support!</p>
//     `,
//   };

//   await transporter.sendMail(mailOptions);
// }


function generateEmailContent(accountabilityPartner, sharedData) {
  // Generate HTML content for the email based on the shared data
  // You can create a more sophisticated template here
  let content = `<h1>Trading Accountability Update</h1>
                 <p>Hello ${accountabilityPartner.name},</p>
                 <p>Here's the latest update on your trading accountability partner:</p>`;

  for (const [key, value] of Object.entries(sharedData)) {
    content += `<p><strong>${key}:</strong> ${value}</p>`;
  }

  content += `<p>Keep up the great work!</p>`;

  return content;
}

exports.sendScheduledEmails = async () => {
  const today = new Date();
  const isEndOfMonth =
    today.getDate() ===
    new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const isWeekly = today.getDay() === 0; // Sunday

  const partners = await AccountabilityPartner.find({
    $or: [
      {
        shareFrequency: "weekly",
        lastSharedDate: { $lt: moment().subtract(1, "week").toDate() },
      },
      {
        shareFrequency: "monthly",
        lastSharedDate: { $lt: moment().subtract(1, "month").toDate() },
      },
    ],
  });

  for (const partner of partners) {
    if (
      (partner.shareFrequency === "weekly" && isWeekly) ||
      (partner.shareFrequency === "monthly" && isEndOfMonth)
    ) {
      await sendAccountabilityEmail(partner);
    }
  }
};


exports.sendTestScheduledEmails = async (req, res) => {
  try {
    const today = new Date();
    const isEndOfMonth =
      today.getDate() ===
      new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const isWeekly = today.getDay() === 0; // Sunday

    // For testing purposes, we'll ignore the actual date and send emails for all partners
    const partners = await AccountabilityPartner.find();

    for (const partner of partners) {
      // Simulate weekly emails
      if (partner.shareFrequency === "weekly") {
        await sendAccountabilityEmail(partner);
      }
      // Simulate monthly emails
      else if (partner.shareFrequency === "monthly") {
        await sendAccountabilityEmail(partner);
      }
    }

    // If called via API, send a response
    if (res) {
      res.status(200).send({ message: "Scheduled emails sent successfully" });
    }
  } catch (error) {
    console.error("Error sending scheduled emails:", error);
    if (res) {
      res.status(500).send({ error: "Failed to send scheduled emails" });
    }
  }
};

module.exports = exports;
