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
  const options = {
    amount: Number(amount * 100),
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
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Payment success controller
exports.paymentsuccess = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } =
    req.body;

  const body = razorpay_order_id + "|" + razorpay_payment_id;

  const expectedSignature = crypto
    .createHmac("sha256", process.env.KEY_SECRET)
    .update(body.toString())
    .digest("hex");

  const isAuthentic = expectedSignature === razorpay_signature;

  if (isAuthentic) {
    await Payment.create({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });

    // Update user subscription
    const user = await User.findById(req.user._id);
    user.subscription.plan = plan;

    // Calculate expiration date based on the plan
    const currentDate = new Date();
    switch (plan) {
      case "one-week":
        user.subscription.expiresAt = new Date(
          currentDate.setDate(currentDate.getDate() + 7)
        );
        break;
      case "half-year":
        user.subscription.expiresAt = new Date(
          currentDate.setMonth(currentDate.getMonth() + 6)
        );
        break;
      case "yearly":
        user.subscription.expiresAt = new Date(
          currentDate.setFullYear(currentDate.getFullYear() + 1)
        );
        break;
      default:
        user.subscription.expiresAt = null;
    }

    await user.save();

      // Return success response
      res.status(200).json({
        success: true,
        reference: razorpay_payment_id,
        plan,
        message: "Payment and subscription updated successfully.",
      });
  } else {
    res.status(400).json({
      success: false,
    });
  }
};