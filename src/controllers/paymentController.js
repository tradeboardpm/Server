const Payment = require("../models/Payment");
const User = require("../models/User");
const Plan = require("../models/Plan");
const Coupon = require("../models/Coupon");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const moment = require("moment");

console.log("Razorpay Config:", {
  key_id: process.env.KEY_ID,
  key_secret: process.env.KEY_SECRET ? "[REDACTED]" : undefined,
});

const instance = new Razorpay({
  key_id: process.env.KEY_ID,
  key_secret: process.env.KEY_SECRET,
});

exports.checkout = async (req, res) => {
  const { amount, plan, couponCode, gstin } = req.body;
  const user = req.user;

  if (!amount || !plan) {
    return res.status(400).json({ success: false, error: "Amount and plan are required." });
  }

  const planData = await Plan.findOne({ plan_name: plan });
  if (!planData) {
    return res.status(400).json({ success: false, error: "Invalid plan." });
  }

  let finalAmount = planData.plan_total_price;
  let discountApplied = 0;

  if (couponCode) {
    try {
      const coupon = await Coupon.findOne({ code: couponCode });
      if (!coupon) {
        return res.status(400).json({ success: false, error: "Coupon not found." });
      }
      if (coupon.expiresAt < new Date()) {
        return res.status(400).json({ success: false, error: "Coupon has expired." });
      }
      // Check if THIS specific coupon has been used by the user
      if (coupon.usedBy.includes(user._id)) {
        return res.status(400).json({ success: false, error: "This coupon has already been used by you." });
      }
      if (coupon.maxUses <= coupon.usedBy.length) {
        return res.status(400).json({ success: false, error: "Coupon usage limit reached." });
      }

      discountApplied = (finalAmount * coupon.discount) / 100;
      finalAmount -= discountApplied;
    } catch (error) {
      console.error("Coupon validation error:", error);
      return res.status(500).json({ success: false, error: "Failed to validate coupon." });
    }
  }

  finalAmount = Math.round(finalAmount * 100) / 100;

  if (finalAmount < 1) {
    return res.status(200).json({
      success: true,
      order: null,
      plan,
      finalAmount,
      discountApplied,
      gstin,
      message: "Subscription granted for free due to discount.",
    });
  }

  const options = {
    amount: Number(finalAmount * 100), // Convert to paise
    currency: "INR",
  };

  if (isNaN(options.amount) || options.amount < 100) {
    return res.status(400).json({ success: false, error: "Invalid amount after discount." });
  }

  console.log("Checkout options:", options);

  try {
    const order = await instance.orders.create(options);
    console.log("Order created:", order);
    res.status(200).json({ success: true, order, plan, finalAmount, discountApplied, gstin });
  } catch (error) {
    console.error("Checkout error:", {
      message: error.message,
      status: error.status,
      response: error.response ? error.response.data : null,
    });
    res.status(500).json({ success: false, error: "Failed to create payment order." });
  }
};

exports.paymentsuccess = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan, couponCode, gstin } = req.body;
  const user = req.user;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !plan) {
    return res.status(400).json({ success: false, error: "Missing required payment details." });
  }

  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.KEY_SECRET)
    .update(body.toString())
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ success: false, error: "Invalid payment signature." });
  }

  try {
    const planData = await Plan.findOne({ plan_name: plan });
    if (!planData) {
      return res.status(400).json({ success: false, error: "Invalid plan." });
    }

    let finalAmount = planData.plan_total_price;
    let discountApplied = 0;

    if (couponCode) {
      const coupon = await Coupon.findOne({ code: couponCode });
      if (!coupon) {
        return res.status(400).json({ success: false, error: "Coupon not found." });
      }
      if (coupon.expiresAt < new Date()) {
        return res.status(400).json({ success: false, error: "Coupon has expired." });
      }
      if (coupon.usedBy.includes(user._id)) {
        return res.status(400).json({ success: false, error: "This coupon has already been used by you." });
      }
      if (coupon.maxUses <= coupon.usedBy.length) {
        return res.status(400).json({ success: false, error: "Coupon usage limit reached." });
      }

      discountApplied = (finalAmount * coupon.discount) / 100;
      finalAmount -= discountApplied;
      coupon.usedBy.push(user._id);
      await coupon.save();
    }

    const payment = await Payment.create({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      user: user._id,
      userName: user.name,
      plan,
      plan_price: finalAmount,
      couponCode,
      discountApplied,
      gstin,
      buy_date: new Date(),
    });

    user.subscription.plan = plan;
    user.subscription.expiresAt = moment().add(planData.durationDays, "days").toDate();
    if (gstin) {
      user.gstin = gstin;
    }
    await user.save().catch((err) => {
      throw new Error(`Failed to update user subscription: ${err.message}`);
    });

    res.status(200).json({
      success: true,
      reference: razorpay_payment_id,
      plan,
      message: "Payment and subscription updated successfully.",
    });
  } catch (error) {
    console.error("Payment success error:", error);
    res.status(500).json({ success: false, error: "Failed to process payment success." });
  }
};

exports.getKey = (req, res) => {
  res.status(200).json({ success: true, key: process.env.KEY_ID });
};