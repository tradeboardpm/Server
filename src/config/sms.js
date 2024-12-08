require("dotenv").config();
const twilio = require("twilio");

let client;

if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
} else {
  console.error("Twilio credentials are missing. Please check your .env file.");
  client = null;
}

module.exports = client;
