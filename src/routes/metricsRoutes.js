const express = require("express");
const metricsController = require("../controllers/metricsController");
const auth = require("../middleware/auth");

const router = express.Router();

router.get("/date-range", auth, metricsController.getDateRangeMetrics);
router.get("/weekly", auth, metricsController.getWeeklyData);
router.get(
  "/monthly",
  auth,
  metricsController.getMonthlyProfitLossDates
);

module.exports = router;
