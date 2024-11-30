const express = require("express");
const adminController = require("../controllers/adminController");
const adminAuth = require("../middleware/adminAuth");
const announcementController = require("../controllers/announcementController");

const router = express.Router();

// admin auth routes
router.post("/login", adminController.login);
router.post("/verify-otp", adminController.verifyOTP);

// user management routes
router.get("/users", adminAuth, adminController.listUsers);
router.get("/users/:query", adminAuth, adminController.findUser);
router.patch("/users/:id", adminAuth, adminController.editUser);
router.delete("/users/:id", adminAuth, adminController.deleteUser);

// statistics routes
router.get("/stats", adminAuth, adminController.getStats);

// charge rates routes
router.get('/charge-rates', adminAuth, adminController.getChargeRates);
router.patch("/charge-rates", adminAuth, adminController.updateChargeRates);
router.post("/reset-charge-rates", adminAuth, adminController.resetChargeRates);

// Admins routes
router.post("/admins", adminAuth, adminController.createAdmin);
router.delete('/admins/:id', adminAuth, adminController.deleteAdmin);
router.get('/admins', adminAuth, adminController.listAdmins);

// Announcement routes
router.post('/announcements', adminAuth, announcementController.createAnnouncement);
router.get('/announcements', adminAuth, announcementController.listAnnouncements);
router.patch('/announcements/:id', adminAuth, announcementController.editAnnouncement);
router.delete('/announcements/:id', adminAuth, announcementController.deleteAnnouncement);
router.post('/announcements/:id/toggle', adminAuth, announcementController.toggleAnnouncement);


module.exports = router;
