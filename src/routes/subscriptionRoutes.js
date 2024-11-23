const express = require("express");
const subscriptionController = require("../controllers/subscriptionController");
const auth = require("../middleware/auth");

const router = express.Router();

router.patch("/", auth, subscriptionController.updateSubscription);
router.get("/", auth, subscriptionController.getSubscription);

module.exports = router;
