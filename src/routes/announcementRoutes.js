const express = require('express');
const announcementController = require('../controllers/announcementController');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

const router = new express.Router();

// Admin routes
router.post('/admin', adminAuth, announcementController.createAnnouncement);
router.get('/admin', adminAuth, announcementController.getAnnouncements);
router.get("/admin/:id", adminAuth, announcementController.getAnnouncements);
router.patch('/admin/:id', adminAuth, announcementController.updateAnnouncement);
router.delete('/admin/:id', adminAuth, announcementController.deleteAnnouncement);

// User routes
router.get('/', auth, announcementController.getActiveAnnouncementsForUser);
router.post('/:id/view', auth, announcementController.viewAnnouncement);

module.exports = router;

