const express = require('express');
const {
  sendGuestOTP,
  registerGuest,
  loginGuest,
  getGuestProfile,
  updateGuestProfile,
  logoutGuest,
  updateGuestFCMToken
} = require('../controllers/guestAuth.controller');
const { guestAuth } = require('../middlewares/auth');

const router = express.Router();

// Public routes
router.post('/send-otp', sendGuestOTP);
router.post('/register', registerGuest);
router.post('/login', loginGuest);

// Protected routes (require guest authentication)
router.use(guestAuth); // Apply guest auth middleware to all routes below

router.get('/profile', getGuestProfile);
router.put('/profile', updateGuestProfile);
router.post('/logout', logoutGuest);
router.post('/fcm-token', updateGuestFCMToken);

module.exports = router;