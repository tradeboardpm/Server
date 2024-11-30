const express = require("express");
const ruleController = require("../controllers/ruleController");
const auth = require("../middleware/auth");

const router = express.Router();

router.post("/", auth, ruleController.createRule);
router.get("/", auth, ruleController.getRules);
router.patch("/:id", auth, ruleController.updateRule);
router.delete("/:id", auth, ruleController.deleteRule);
router.post("/load-sample", auth, ruleController.loadSampleRules);
router.post("/follow-no-journal", auth, ruleController.followRuleNoJournal);

module.exports = router;
