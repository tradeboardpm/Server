const express = require("express");
const tradeController = require("../controllers/tradeController");
const auth = require("../middleware/auth");

const router = express.Router();

router.post("/", auth, tradeController.createTrade);
router.get("/", auth, tradeController.getTrades);
router.get("/date", auth, tradeController.getTradesByDate);
router.patch("/:id", auth, tradeController.updateTrade);
router.delete("/:id", auth, tradeController.deleteTrade);

module.exports = router;
