const express = require("express");
const router = express.Router();
const Plan = require("../models/Plan");

router.get("/", async (req, res) => {
  try {
    const plans = await Plan.find({ active: true }).sort({ plan_total_price: 1 });
    res.status(200).json({ success: true, plans });
  } catch (error) {
    console.error("Error fetching plans:", error);
    res.status(500).json({ success: false, error: "Failed to fetch plans" });
  }
});

router.post("/seed", async (req, res) => {
  const initialPlans = [
    {
      name: "Two Weeks on Us",
      subtitle: "(₹ 0)",
      plan_name: "one-week",
      plan_total_price: 0,
      price: "Free",
      period: "",
      durationDays: 14,
      features: [
        "Dashboard",
        "My Journal",
        "Trade Logs",
        "Weekly/Monthly Analysis",
        "Performance Analytics",
        "Accountability Partner",
      ],
      buttonText: "Get Started Now",
    },
    {
      name: "Half-Year Adventure",
      subtitle: "(₹ 1,194 / Half Year)",
      plan_name: "half-year",
      plan_total_price: 1194,
      price: "199",
      period: "per month",
      durationDays: 180,
      features: [
        "Dashboard",
        "My Journal",
        "Trade Logs",
        "Weekly/Monthly Analysis",
        "Performance Analytics",
        "Accountability Partner",
      ],
      buttonText: "Get Started Now",
    },
    {
      name: "Year of Possibilities",
      subtitle: "(₹ 1,788 / Year)",
      plan_name: "yearly",
      plan_total_price: 1788,
      price: "149",
      period: "per month",
      durationDays: 365,
      features: [
        "Dashboard",
        "My Journal",
        "Trade Logs",
        "Weekly/Monthly Analysis",
        "Performance Analytics",
        "Accountability Partner",
      ],
      buttonText: "Get Started Now",
      buttonVariant: "default",
      highlight: true,
      discount: true,
    },
  ];

  try {
    await Plan.deleteMany({});
    const plans = await Plan.insertMany(initialPlans);
    res.status(201).json({ success: true, plans, message: "Plans seeded successfully" });
  } catch (error) {
    console.error("Error seeding plans:", error);
    res.status(500).json({ success: false, error: "Failed to seed plans" });
  }
});

module.exports = router;