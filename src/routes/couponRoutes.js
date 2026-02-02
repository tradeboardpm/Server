const express = require("express");
const router = express.Router();
const Coupon = require("../models/Coupon");
const moment = require("moment");
const adminAuth = require("../middleware/adminAuth");

router.post("/", adminAuth, async (req, res) => {
  if (!req.user || !req.user._id) {
    return res.status(401).json({ success: false, error: "Unauthorized: Admin user not found" });
  }

  const { code, discount, expiresAt, maxUses } = req.body;
  try {
    const existingCoupon = await Coupon.findOne({ code });
    if (existingCoupon) {
      return res.status(400).json({ success: false, error: "Coupon code already exists." });
    }

    const coupon = new Coupon({
      code,
      discount,
      expiresAt: expiresAt || moment().add(7, "days").toDate(),
      maxUses: maxUses || 1,
      createdBy: req.user._id,
    });
    await coupon.save();
    res.status(201).json({ success: true, coupon });
  } catch (error) {
    console.error("Coupon creation error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/", adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const coupons = await Coupon.find({})
      .skip(skip)
      .limit(limit)
      .populate("createdBy", "username email")
      .populate("usedBy", "name email");

    const total = await Coupon.countDocuments();

    res.status(200).json({
      success: true,
      coupons,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put("/:id", adminAuth, async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!coupon) return res.status(404).json({ success: false, error: "Coupon not found" });
    res.status(200).json({ success: true, coupon });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete("/:id", adminAuth, async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, error: "Coupon not found" });
    res.status(200).json({ success: true, message: "Coupon deleted" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;