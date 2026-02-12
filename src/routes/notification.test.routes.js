const express = require('express');
const router = express.Router();
const {
  testSendNotification,
  checkFCMTokens,
  checkFirebaseStatus
} = require('../controllers/notification.test.controller');

// Test endpoints (should be protected in production)
router.post('/send-notification', testSendNotification);
router.get('/check-fcm-tokens/:userId', checkFCMTokens);
router.get('/firebase-status', checkFirebaseStatus);

module.exports = router;
