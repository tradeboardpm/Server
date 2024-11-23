const express = require("express");
const capitalController = require("../controllers/capitalController");
const auth = require("../middleware/auth");

const router = express.Router();

router.get("/", auth, capitalController.getCapital);
router.patch("/", auth, capitalController.updateCapital);
router.get("/history", auth, capitalController.getCapitalHistory);

module.exports = router;
