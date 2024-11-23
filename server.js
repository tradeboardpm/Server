require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const authRoutes = require("./src/routes/authRoutes");
const journalRoutes = require("./src/routes/journalRoutes");
const ruleRoutes = require("./src/routes/ruleRoutes");
const tradeRoutes = require("./src/routes/tradeRoutes");
const capitalRoutes = require("./src/routes/capitalRoutes");
const subscriptionRoutes = require("./src/routes/subscriptionRoutes");
const metricsRoutes = require("./src/routes/metricsRoutes");
const { initializeChargeRates } = require("./src/utils/tradeCalculations");

const app = express();

// Middleware
app.use(express.json());

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
