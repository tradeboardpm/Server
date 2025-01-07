const express = require("express");
const adminController = require("../controllers/adminController");
const adminAuth = require("../middleware/adminAuth");

const router = express.Router();

// admin auth routes
router.post("/login", adminController.login);
router.post("/verify-otp", adminController.verifyOTP);
router.post('/create', adminAuth, adminController.createAdmin);
router.delete('/:id', adminAuth, adminController.deleteAdmin);
router.get('/list', adminAuth, adminController.listAdmins);

// New routes
router.get('/users', adminAuth, adminController.listUsers);
router.patch('/users/:id', adminAuth, adminController.editUser);
router.delete('/users/:id', adminAuth, adminController.deleteUser);


module.exports = router;
