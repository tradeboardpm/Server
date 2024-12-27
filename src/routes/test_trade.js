const express = require("express");
const trade_test = require("../controllers/trade_test");
const auth = require("../middleware/auth");

const router = express.Router();

router.post("/", auth, trade_test.addTrade);
router.put("/open/:id", auth, trade_test.editOpenTrade);
router.put("/complete/:id", auth, trade_test.editCompleteTrade);
router.delete("/:id", auth, trade_test.deleteTrade);
router.get("/user", auth, trade_test.getUserTrades);

module.exports = router;
