const express = require('express');
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
} = require('../controllers/notification.controller');
const {
  testFirebaseSetup,
  sendTestNotification,
  sendTemplateNotification,
  getNotificationTemplates
} = require('../controllers/notification.test.controller');
const { protect } = require('../middlewares/auth');

const router = express.Router();

router.use(protect);

// Test endpoints
router.get('/test-firebase', testFirebaseSetup);
router.post('/test-send', sendTestNotification);
router.get('/templates', getNotificationTemplates);
router.post('/send-template', sendTemplateNotification);

// Regular notification endpoints
router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.put('/:id/read', markAsRead);
router.put('/read-all', markAllAsRead);
router.delete('/:id', deleteNotification);

module.exports = router;

