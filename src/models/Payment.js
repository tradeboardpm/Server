const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  razorpay_order_id: { type: String, required: true },
  razorpay_payment_id: { type: String, required: true },
  razorpay_signature: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  userName: { type: String, required: true }, // Added userName field
  plan: { type: String, required: true },
  plan_price: { type: Number, required: true },
  couponCode: { type: String },
  discountApplied: { type: Number, default: 0 },
  gstin: { type: String }, // Added GSTIN field
  buy_date: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Payment", paymentSchema);