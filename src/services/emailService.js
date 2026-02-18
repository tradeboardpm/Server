const fs = require("fs").promises;
const path = require("path");
const jwt = require("jsonwebtoken");
const handlebars = require("handlebars");
const { SendMailClient } = require("zeptomail");

const ZOHO_API_URL = "api.zeptomail.in/";
const client = new SendMailClient({
  url: ZOHO_API_URL,
  token: process.env.ZOHO_ZEPTOMAIL_API_KEY,
});

async function loadTemplate(templateName) {
  const templatePath = path.join(
    __dirname,
    "..",
    "emailTemplates",
    `${templateName}.hbs`
  );
  const templateContent = await fs.readFile(templatePath, "utf-8");
  return handlebars.compile(templateContent);
}

async function sendEmail(to, subject, templateName, context, sendAt = null) {
  const template = await loadTemplate(templateName);
  const html = template(context);

  const msg = {
    from: {
      address: process.env.EMAIL_USER,
      name: "Tradeboard",
    },
    to: [
      {
        email_address: {
          address: to,
          name: context.name || context.partnerName || "Recipient",
        },
      },
    ],
    subject,
    htmlbody: html,
  };

  try {
    const response = await client.sendMail(msg);
    return response;
  } catch (error) {
    const errorDetail = error.response?.data || error.message || error;
    throw new Error(`Failed to send email: ${JSON.stringify(errorDetail)}`);
  }
}

module.exports = {
  sendOTP: async (email, otp, name, type) => {
    let subject, templateName;
    switch (type) {
      case "registration":
        subject = "Verify Your Email for Tradeboard";
        templateName = "registrationOTP";
        break;
      case "resend":
        subject = "Your New OTP for Tradeboard";
        templateName = "resendOTP";
        break;
      case "resetPassword":
        subject = "OTP to Reset Your Password";
        templateName = "resetPasswordOTP";
        break;
      default:
        throw new Error("Invalid OTP type");
    }
    await sendEmail(email, subject, templateName, { name, otp });
  },

  sendNewPartnerEmail: async (user, partner) => {
    // NEVER EXPIRES after verification token (after they verify once)
    const token = jwt.sign(
      { userId: user._id, apId: partner._id },
      process.env.JWT_SECRET
      // Removed { expiresIn: "7d" } → token lives forever after verification
    );

    const frontendUrl = partner.originUrl || process.env.FRONTEND_URL || "https://yourapp.com";
    const verificationLink = `${frontendUrl}/ap-verification?token=${token}`;
    const directDataLink = `${frontendUrl}/ap-data?token=${token}`; // Bonus: direct access link

    await sendEmail(
      partner.email,
      "You've Been Added as an Accountability Partner on Tradeboard",
      "newPartner",
      {
        userName: user.username || user.name || "A trader",
        partnerName: partner.name,
        verificationLink,
        directDataLink, // Optional: let them go straight to data after verification
      }
    );
  },

  sendWelcomeEmail: async (email, name) => {
    const subject = "Welcome to Tradeboard!";
    const templateName = "welcome";
    await sendEmail(email, subject, templateName, { name });
  },

  sendAdminOTP: async (email, otp) => {
    try {
      await sendEmail(
        email,
        "Tradeboard Admin - Your OTP for Login",
        "adminOTP",
        { otp }
      );
    } catch (err) {
      throw err;
    }
  },

  sendSubscriptionConfirmation: async (
    email,
    username,
    planName,
    planExpirationDate
  ) => {
    const subject = "Congratulations on Your Tradeboard Subscription!";
    const templateName = "subscriptionConfirmation";
    await sendEmail(email, subject, templateName, {
      username,
      planName,
      planExpirationDate: planExpirationDate.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
    });
  },
};
