const express = require('express');
const journalController = require('../controllers/journalController');
const auth = require('../middleware/auth');
const { upload } = require('../config/s3');

const router = express.Router();

router.post('/', auth, upload.array('attachedFiles', 5), journalController.createOrUpdateJournal);
router.get('/', auth, journalController.getJournal);
router.delete('/:id', auth, journalController.deleteJournal);
router.patch('/edit-rule', auth, journalController.editRuleInJournal);
router.delete('/delete-rule', auth, journalController.deleteRuleFromJournal);
router.post('/follow-unfollow-rule', auth, journalController.followUnfollowRule);
router.get('/monthly', auth, journalController.getMonthlyJournals);

module.exports = router;

