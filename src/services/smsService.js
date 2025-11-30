const client = require("../config/sms");

exports.sendOTP = async (phone) => {
  try {
    const result = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verifications.create({ to: phone, channel: "sms" });

    // console.log("OTP sent successfully. SID:", result.sid);
    return result;
  } catch (error) {
    console.error("OTP sending failed:", {
      errorCode: error.code,
      errorMessage: error.message,
      phone: phone,
    });

    if (error.code === 21614) {
      throw new Error("Invalid phone number format");
    } else if (error.code === 21608) {
      throw new Error("Unverified phone number");
    } else if (error.code === 20003) {
      throw new Error("Authentication failed - check TWILIO credentials");
    } else if (error.code === 20404) {
      throw new Error("Invalid Twilio phone number");
    }

    throw new Error("Failed to send OTP: " + error.message);
  }
};

exports.verifyOTP = async (phone, otp) => {
  try {
    const result = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verificationChecks.create({ to: phone, code: otp });

    if (result.status === "approved") {
      return { success: true, message: "OTP verified successfully" };
    } else {
      return { success: false, message: "Invalid OTP" };
    }
  } catch (error) {
    console.error("Error verifying OTP:", error.message);

    if (error.code === 21612) {
      throw new Error("OTP verification failed. Check if OTP is expired");
    } else if (error.code === 20003) {
      throw new Error("Authentication failed - check TWILIO credentials");
    }

    throw new Error("Failed to verify OTP: " + error.message);
  }
};
