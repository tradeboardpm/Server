const nodemailer = require("nodemailer");
const fs = require("fs").promises;
const path = require("path");
const handlebars = require("handlebars");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
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

async function sendEmail(to, subject, templateName, context) {
  const template = await loadTemplate(templateName);
  const html = template(context);

  const mailOptions = {
    from: process.env.GMAIL_EMAIL,
    to,
    subject,
    html,
  };

  await transporter.sendMail(mailOptions);
}

module.exports = {
  sendNewPartnerEmail: async (user, partner) => {
    await sendEmail(
      partner.email,
      "Welcome to Tradeboard - You've Been Added as an Accountability Partner",
      "newPartner",
      {
        userName: user.username,
        partnerName: partner.name,
        frequency: partner.shareFrequency,
      }
    );
  },

  sendAccountabilityUpdate: async (partner, sharedData) => {
    await sendEmail(
      partner.email,
      "Tradeboard - Your Trading Accountability Update",
      "accountabilityUpdate",
      { partnerName: partner.name, sharedData }
    );
  },
};
