const express = require('express');
const journalController = require('../controllers/journalController');
const auth = require('../middleware/auth');
const { upload } = require('../config/s3');

const router = express.Router();

router.post('/', auth, upload.array('attachedFiles', 5), journalController.createOrUpdateJournal);
router.get('/', auth, journalController.getJournal);
router.delete("/:date", auth, journalController.deleteJournal);
router.get('/monthly', auth, journalController.getMonthlyJournals);
router.get("/filters", auth, journalController.getFiltersJournals);
router.get("/details", auth, journalController.getJournalDetails);

router.delete("/:journalId/file/:fileKey", auth, journalController.deleteFile);


module.exports = router;