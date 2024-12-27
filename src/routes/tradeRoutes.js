const express = require("express");
const tradeController = require("../controllers/tradeController");
const auth = require("../middleware/auth");

const router = express.Router();

router.get("/by-date", auth, tradeController.getTradesByDate);
router.post("/", auth, tradeController.addTrade);
router.patch("/open/:id", auth, tradeController.editOpenTrade);
router.patch("/complete/:id", auth, tradeController.editCompleteTrade);
router.delete("/:id", auth, tradeController.deleteTrade);
router.get("/user", auth, tradeController.getUserTrades);

module.exports = router;
