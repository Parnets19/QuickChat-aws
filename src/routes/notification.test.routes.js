const express = require('express');
const router = express.Router();
const {
  testSendNotification,
  checkFCMTokens,
  checkFirebaseStatus,
  testCallNotification,
  testChatNotification
} = require('../controllers/notification.test.controller');

// Test endpoints (should be protected in production)
router.post('/send-notification', testSendNotification);
router.post('/test-call-notification', testCallNotification);
router.post('/test-chat-notification', testChatNotification);
router.get('/check-fcm-tokens/:userId', checkFCMTokens);
router.get('/firebase-status', checkFirebaseStatus);

module.exports = router;
