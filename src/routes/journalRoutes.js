const express = require('express');
const journalController = require('../controllers/journalController');
const auth = require('../middleware/auth');
const { upload } = require('../config/s3');

const router = express.Router();

router.post('/follow-unfollow-rule', auth, journalController.followUnfollowRule);
router.delete('/delete-rule', auth, journalController.deleteRuleFromJournal);
router.post('/', auth, upload.array('attachedFiles', 5), journalController.createOrUpdateJournal);
router.get('/', auth, journalController.getJournal);
router.delete('/:id', auth, journalController.deleteJournal);
router.post('/add-rule', auth, journalController.addRule);
router.patch('/edit-rule', auth, journalController.editRuleInJournal);
router.get('/monthly', auth, journalController.getMonthlyJournals);
router.get("/filters", auth, journalController.getFiltersJournals);
router.get("/details", auth, journalController.getJournalDetails);

router.delete("/:journalId/file/:fileKey", auth, journalController.deleteFile);

router.post("/follow-unfollow-all", auth, journalController.followUnfollowAll);

module.exports = router;