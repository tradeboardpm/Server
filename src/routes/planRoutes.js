const express = require("express");
const router = express.Router();
const Plan = require("../models/Plan");

// Get all active plans
router.get("/", async (req, res) => {
  try {
    const plans = await Plan.find({ active: true }).sort({ plan_total_price: 1 });
    res.status(200).json({
      success: true,
      plans,
    });
  } catch (error) {
    console.error("Error fetching plans:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch plans",
      details: error.message,
    });
  }
});

// Create a new plan (Admin only - add middleware for authentication)
router.post("/", async (req, res) => {
  try {
    const planData = req.body;
    const plan = new Plan(planData);
    await plan.save();
    res.status(201).json({
      success: true,
      plan,
      message: "Plan created successfully",
    });
  } catch (error) {
    console.error("Error creating plan:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create plan",
      details: error.message,
    });
  }
});

// Seed initial plans (optional - run once)
router.post("/seed", async (req, res) => {
  const initialPlans = [
    {
      name: "One Week on Us",
      subtitle: "(₹ 0)",
      plan_name: "one-week",
      plan_total_price: 0,
      price: "Free",
      period: "",
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
    res.status(201).json({
      success: true,
      plans,
      message: "Plans seeded successfully",
    });
  } catch (error) {
    console.error("Error seeding plans:", error);
    res.status(500).json({
      success: false,
      error: "Failed to seed plans",
      details: error.message,
    });
  }
});

module.exports = router;