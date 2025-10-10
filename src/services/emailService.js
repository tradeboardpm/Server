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

  if (sendAt) {
    // console.warn(`Scheduling not supported by ZeptoMail. Sending email immediately to ${to}. Scheduled time was ${sendAt.toISOString()}`);
  }

  try {
    const response = await client.sendMail(msg);
    // console.log("Email sent successfully:", JSON.stringify(response, null, 2));
    return response;
  } catch (error) {
    const errorDetail = error.response?.data || error.message || error;
    // console.error("ZeptoMail error details:", JSON.stringify(errorDetail, null, 2));
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
    const token = jwt.sign(
      { userId: user._id, apId: partner._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const frontendUrl = process.env.FRONTEND_URL;
    const verificationLink = `${frontendUrl}/ap-verification?token=${token}`;

    await sendEmail(
      partner.email,
      "Welcome to Tradeboard - You've Been Added as an Accountability Partner",
      "newPartner",
      {
        userName: user.username,
        partnerName: partner.name,
        frequency: partner.shareFrequency,
        verificationLink,
      }
    );
  },

  sendAccountabilityUpdate: async (partner, sharedData, sendAt = null) => {
    const token = jwt.sign(
      { userId: partner.user, apId: partner._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const frontendUrl = process.env.FRONTEND_URL;
    const dataViewLink = `${frontendUrl}/ap-data?token=${token}`;

    await sendEmail(
      partner.email,
      "Tradeboard - Your Trading Accountability Update",
      "accountabilityUpdate",
      {
        partnerName: partner.name,
        dataViewLink,
        sharedData,
      },
      sendAt
    );
  },

  sendWelcomeEmail: async (email, name) => {
    const subject = "Welcome to Tradeboard!";
    const templateName = "welcome";
    await sendEmail(email, subject, templateName, { name });
  },

  sendAdminOTP: async (email, otp) => {
    // console.log("📧 Sending admin OTP to:", email, "with OTP:", otp);
    try {
      await sendEmail(
        email,
        "Tradeboard Admin - Your OTP for Login",
        "adminOTP",
        { otp }
      );
      // console.log("✅ Admin OTP email sent successfully");
    } catch (err) {
      // console.error("❌ Failed to send admin OTP:", err.message || err);
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