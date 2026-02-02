// admin-seed.js
require("dotenv").config();
const mongoose = require("mongoose");
const Admin = require("./src/models/Admin");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/yourdbname";

async function seedAdmin() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const existingAdmin = await Admin.findOne({ email: "bhushan12.uparkar@gmail.com" });
    if (existingAdmin) {
      // console.log("Admin with this email already exists.");
      process.exit();
    }

    const admin = new Admin({
      username: "Bhushan",
      email: "bhushan12.uparkar@gmail.com",
      adminType: "super",
    });

    await admin.save();
    // console.log("✅ Super admin created successfully:", admin);
    process.exit();
  } catch (error) {
    console.error("❌ Error creating super admin:", error);
    process.exit(1);
  }
}

seedAdmin();
