const express = require("express");
const ruleController = require("../controllers/ruleController");
const auth = require("../middleware/auth");

const router = express.Router();

router.get("/", auth, ruleController.getRules);
router.post("/", auth, ruleController.addRule);
router.patch("/:id", auth, ruleController.updateRule);
router.delete("/:id", auth, ruleController.deleteRule);
router.post("/follow-unfollow", auth, ruleController.followUnfollowRule);
router.post("/load-sample", auth, ruleController.loadSampleRules);
router.post("/bulk", auth, ruleController.bulkAddRules); // New bulk endpoint

module.exports = router;