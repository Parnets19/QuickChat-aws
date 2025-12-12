const express = require('express');
const {
  sendOTP,
  verifyOTP,
  register,
  login,
  loginWithOTP,
  getMe,
  logout,
  refreshToken,
  updateFCMToken,
  guestLogin,
} = require('../controllers/auth.controller');
const { protect } = require('../middlewares/auth');
const { otpLimiter, authLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

router.post('/send-otp', otpLimiter, sendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/register', authLimiter, register);
router.post('/login', process.env.NODE_ENV === 'development' ? (req, res, next) => next() : authLimiter, login);
router.post('/login-otp', authLimiter, loginWithOTP);
router.post('/guest-login', authLimiter, guestLogin);
router.get('/me', protect, getMe);
router.post('/logout', protect, logout);
router.post('/refresh-token', refreshToken);
router.post('/fcm-token', protect, updateFCMToken);

module.exports = router;

