const fs = require("fs").promises;
const path = require("path");
const jwt = require("jsonwebtoken");
const handlebars = require("handlebars");
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

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

async function sendEmail(to, subject, templateName, context) {
  const template = await loadTemplate(templateName);
  const html = template(context);

  const msg = {
    to,
    from: process.env.EMAIL_USER, // Use your verified sender email
    subject,
    html,
  };

  await sgMail.send(msg);
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
        subject = "Reset Your Password for Tradeboard";
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

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
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

  sendAccountabilityUpdate: async (partner, sharedData) => {
    const token = jwt.sign(
      { userId: partner.user, apId: partner._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const dataViewLink = `${frontendUrl}/ap-data?token=${token}`;

    await sendEmail(
      partner.email,
      "Tradeboard - Your Trading Accountability Update",
      "accountabilityUpdate",
      {
        partnerName: partner.name,
        dataViewLink,
        sharedData,
      }
    );
  },

  sendAdminOTP: async (email, otp) => {
    await sendEmail(
      email,
      "Tradeboard Admin - Your OTP for Login",
      "adminOTP",
      { otp }
    );
  },
};