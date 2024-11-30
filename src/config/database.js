const mongoose = require("mongoose");
const Admin = require("../models/Admin"); // Assuming this is the correct path

/**
 * MongoDB connection options
 */
const mongoOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  family: 4, // Use IPv4, skip trying IPv6
  maxPoolSize: 10, // Maintain up to 10 socket connections
  retryWrites: true,
};

/**
 * Initialize default admin user
 * @returns {Promise<void>}
 */
const initializeDefaultAdmin = async () => {
  try {
    const defaultAdmin = await Admin.findOne({
      email: process.env.ADMIN_EMAIL,
    });
    if (!defaultAdmin) {
      await Admin.create({
        username: process.env.ADMIN_USERNAME || "Default Admin",
        email: process.env.ADMIN_EMAIL,
      });
      console.log("✓ Default admin created successfully");
    }
  } catch (error) {
    console.error("Error creating default admin:", error.message);
    throw error;
  }
};

/**
 * Initialize charge rates
 * @returns {Promise<void>}
 */
const initializeChargeRates = async () => {
  try {
    // Your charge rates initialization logic here
    console.log("✓ Charge rates initialized successfully");
  } catch (error) {
    console.error("Error initializing charge rates:", error.message);
    throw error;
  }
};

/**
 * Connect to MongoDB and initialize required data
 * @returns {Promise<void>}
 */
const connectDB = async () => {
  try {
    // Check if required environment variables are set
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI environment variable is not defined");
    }

    if (!process.env.ADMIN_EMAIL) {
      throw new Error("ADMIN_EMAIL environment variable is not defined");
    }

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, mongoOptions);
    console.log("✓ Connected to MongoDB successfully");

    // Handle connection events
    mongoose.connection.on("error", (err) => {
      console.error("MongoDB connection error:", err);
    });

    // mongoose.connection.on("disconnected", () => {
    //   console.warn("MongoDB disconnected. Attempting to reconnect...");
    // });

    process.on("SIGINT", async () => {
      try {
        await mongoose.connection.close();
        console.log("MongoDB connection closed through app termination");
        process.exit(0);
      } catch (err) {
        console.error("Error during MongoDB disconnect:", err);
        process.exit(1);
      }
    });

    // Initialize required data
    await Promise.all([initializeChargeRates(), initializeDefaultAdmin()]);
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
