const express = require("express");
const { checkout, paymentsuccess } = require("../controllers/paymentController.js")
const auth = require('../middleware/auth');

const router = express.Router()

router.post("/checkout", auth, checkout)
router.post("/payment-success", auth, paymentsuccess)


module.exports = router;
