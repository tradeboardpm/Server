const Payment = require("../models/Payment");
const User = require("../models/User");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const instance = new Razorpay({
  key_id: process.env.KEY_ID,
  key_secret: process.env.KEY_SECRET,
});

// Checkout controller
exports.checkout = async (req, res) => {
  const { amount, plan } = req.body;

  if (!amount || !plan) {
    return res.status(400).json({
      success: false,
      error: "Amount and plan are required.",
    });
  }

  const options = {
    amount: Number(amount * 100), // Convert to paise
    currency: "INR",
  };

  try {
    const order = await instance.orders.create(options);
    res.status(200).json({
      success: true,
      order,
      plan,
    });
  } catch (error) {
    console.error("Checkout error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create payment order.",
    });
  }
};

// Payment success controller
exports.paymentsuccess = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !plan) {
    return res.status(400).json({
      success: false,
      error: "Missing required payment details.",
    });
  }

  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.KEY_SECRET)
    .update(body.toString())
    .digest("hex");

  const isAuthentic = expectedSignature === razorpay_signature;

  if (isAuthentic) {
    try {
      await Payment.create({
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      });

      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ success: false, error: "User not found." });
      }

      user.subscription.plan = plan;
      const currentDate = new Date();

      switch (plan) {
        case "one-week":
          user.subscription.expiresAt = new Date(currentDate.setDate(currentDate.getDate() + 7));
          break;
        case "half-year":
          user.subscription.expiresAt = new Date(currentDate.setMonth(currentDate.getMonth() + 6));
          break;
        case "yearly":
          user.subscription.expiresAt = new Date(currentDate.setFullYear(currentDate.getFullYear() + 1));
          break;
        default:
          user.subscription.expiresAt = null;
      }

      await user.save();

      res.status(200).json({
        success: true,
        reference: razorpay_payment_id,
        plan,
        message: "Payment and subscription updated successfully.",
      });
    } catch (error) {
      console.error("Payment success error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to process payment success.",
      });
    }
  } else {
    res.status(400).json({
      success: false,
      error: "Invalid payment signature.",
    });
  }
};

// Get Razorpay key (add this endpoint)
exports.getKey = (req, res) => {
  res.status(200).json({
    success: true,
    key: process.env.KEY_ID,
  });
};