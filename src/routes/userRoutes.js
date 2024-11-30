const express = require("express");
const userController = require("../controllers/userController");
const auth = require("../middleware/auth");

const router = express.Router();

// ... (previous routes remain unchanged)

router.get("/announcements", auth, userController.getActiveAnnouncements);

module.exports = router;
