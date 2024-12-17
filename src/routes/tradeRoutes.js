const express = require("express");
const tradeController = require("../controllers/tradeController");
const auth = require("../middleware/auth");

const router = express.Router();

router.post("/", auth, tradeController.createTrade);
// router.get("/", auth, tradeController.getTrades);
router.patch("/:id", auth, tradeController.updateTrade);
router.delete("/:id", auth, tradeController.deleteTrade);
router.patch("/open/:id", auth, tradeController.updateOpenTrade);
router.patch("/complete/:id", auth, tradeController.updateCompleteTrade);
router.get("/by-date", auth, tradeController.getTradesByDate);
// router.post("/import", auth, tradeController.importTrades);

module.exports = router;
