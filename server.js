require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const authRoutes = require("./src/routes/authRoutes");
const journalRoutes = require("./src/routes/journalRoutes");
const ruleRoutes = require("./src/routes/ruleRoutes");
const tradeRoutes = require("./src/routes/tradeRoutes");
const capitalRoutes = require("./src/routes/capitalRoutes");
const subscriptionRoutes = require("./src/routes/subscriptionRoutes");
const metricsRoutes = require("./src/routes/metricsRoutes");
const accountabilityPartnerRoutes = require("./src/routes/accountabilityPartnerRoutes");
const { sendScheduledEmails } = require('./src/controllers/accountabilityPartnerController');
const { initializeChargeRates } = require("./src/utils/tradeCalculations");

const app = express();

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : ["http://localhost:3000"], // Default to local development
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true, // Allow credentials (cookies, authorization headers, etc.)
  optionsSuccessStatus: 200, // Some legacy browsers (IE11) choke on 204
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests for all routes
app.options("*", cors(corsOptions));

// Other middleware
app.use(express.json());

// Error handling middleware
app.use((err, req, res, next) => {
  if (err.name === "CORSError") {
    return res.status(403).json({
      error: "CORS Error",
      message: "The request origin is not allowed",
    });
  }
  next(err);
});

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(async () => {
    console.log("Connected to MongoDB");
    // Initialize ChargeRates
    await initializeChargeRates();
  })
  .catch((err) => console.error("MongoDB connection error:", err));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/journals", journalRoutes);
app.use("/api/rules", ruleRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/capital", capitalRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/metrics", metricsRoutes);
app.use("/api/accountability-partners", accountabilityPartnerRoutes);


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// Schedule email sending
const cron = require('node-cron');
cron.schedule('0 0 * * *', async () => {
  console.log('Running scheduled email task');
  await sendScheduledEmails();
});
