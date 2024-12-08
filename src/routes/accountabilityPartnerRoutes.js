const express = require('express');
const accountabilityPartnerController = require('../controllers/accountabilityPartnerController');
const auth = require('../middleware/auth');
const apAuth = require("../middleware/apAuth");

const router = express.Router();

//APIs for user
router.post('/', auth, accountabilityPartnerController.addAccountabilityPartner);
router.get('/', auth, accountabilityPartnerController.getAccountabilityPartners);
router.patch('/:id', auth, accountabilityPartnerController.updateAccountabilityPartner);
router.delete('/:id', auth, accountabilityPartnerController.deleteAccountabilityPartner);

//API for AP
router.get('/shared-data', apAuth, accountabilityPartnerController.getSharedData);

// New route for AP verification
router.post('/verify', accountabilityPartnerController.verifyAccountabilityPartner);

// New route for testing scheduled emails
router.post('/test-scheduled-emails', auth, accountabilityPartnerController.sendTestScheduledEmails);

module.exports = router;

