const express = require('express');
const accountabilityPartnerController = require('../controllers/accountabilityPartnerController');
const auth = require('../middleware/auth');

const router = express.Router();

router.post('/', auth, accountabilityPartnerController.addAccountabilityPartner);
router.get('/', auth, accountabilityPartnerController.getAccountabilityPartners);
router.patch('/:id', auth, accountabilityPartnerController.updateAccountabilityPartner);
router.delete('/:id', auth, accountabilityPartnerController.deleteAccountabilityPartner);
router.get('/shared-data', auth, accountabilityPartnerController.getSharedData);

// New route for testing scheduled emails
router.post('/test-scheduled-emails', auth, accountabilityPartnerController.sendTestScheduledEmails);

module.exports = router;

    