const mongoose = require("mongoose");

const planSchema = new mongoose.Schema({
  name: { type: String, required: true },
  subtitle: { type: String, required: true },
  plan_name: { type: String, required: true, unique: true },
  plan_total_price: { type: Number, required: true },
  price: { type: String, required: true },
  period: { type: String, default: "" },
  durationDays: { type: Number, required: true }, // New field for subscription duration in days
  features: [{ type: String }],
  buttonText: { type: String, default: "Get Started Now" },
  buttonVariant: { type: String, default: "" },
  highlight: { type: Boolean, default: false },
  discount: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Plan", planSchema);