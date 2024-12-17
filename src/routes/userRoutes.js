const express = require('express');
const userController = require('../controllers/userController');
const auth = require('../middleware/auth');

const router = express.Router();

// GET user settings
router.get('/settings', auth, userController.getUserSettings);

// UPDATE user settings (capital, brokerage, trades per day)
router.patch('/settings', auth, userController.updateUserSettings);
router.get('/capital', auth, userController.getCapital);
router.patch('/capital', auth, userController.updateCapital);

router.get("/profile", auth, userController.getProfile);
router.patch("/profile", auth, userController.updateProfile);
router.patch("/change-password", auth, userController.changePassword);

// New routes for Google users
router.post('/create-password', auth, userController.createPasswordForGoogleUser);
router.post('/add-phone', auth, userController.addPhoneNumber);
router.post('/verify-phone', auth, userController.verifyPhoneForGoogleUser);

router.get('/capital/by-month-year', auth, userController.getCapitalByMonthYear);
router.get('/announcements', userController.getActiveAnnouncements);

module.exports = router;

