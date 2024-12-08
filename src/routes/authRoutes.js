const express = require('express');
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');

const router = express.Router();

router.post('/register', authController.register);
router.post('/verify-email-otp', authController.verifyEmailOTP);
router.post('/login-email', authController.loginEmail);
router.post('/login-phone', authController.loginPhone);
router.post('/verify-phone-otp', authController.verifyPhoneOTP);
router.post('/google-login', authController.googleLogin);
router.post("/google-signup", authController.googleSignup);
router.post('/resend-email-otp', authController.resendEmailOTP);
router.post('/resend-phone-otp', authController.resendPhoneOTP);
router.post('/forgot-password', authController.forgotPassword);
router.post('/verify-forgot-password-otp', authController.verifyForgotPasswordOTP);
router.post('/reset-password', authController.resetPassword);
router.post('/logout', auth, authController.logout);
router.post('/logout-all', auth, authController.logoutAll);

module.exports = router;

