const express = require("express");
const journalController = require("../controllers/journalController");
const auth = require("../middleware/auth");
const { upload } = require("../config/s3");

const router = express.Router();

router.post(
  "/",
  auth,
  upload.array("attachedFiles", 5),
  journalController.createOrUpdateJournal
);
router.get("/", auth, journalController.getJournal);
router.delete("/:id", auth, journalController.deleteJournal);
router.post("/move-rule", auth, journalController.moveRule);
router.get("/monthly", auth, journalController.getMonthlyJournals);

module.exports = router;
