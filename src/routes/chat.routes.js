const express = require("express");
const { protect, guestAuth } = require("../middlewares/auth");
const {
  sendMessage,
  getChatHistory,
  getChatNotifications,
  markNotificationAsRead,
  getChatList,
  createOrGetChat,
  markMessagesAsRead,
} = require("../controllers/chat.controller");

const router = express.Router();

// Middleware to handle both regular and guest authentication
const authMiddleware = (req, res, next) => {
  // Try regular auth first
  protect(req, res, (err) => {
    if (err) {
      // If regular auth fails, try guest auth
      guestAuth(req, res, next);
    } else {
      next();
    }
  });
};

// Apply authentication to all routes
router.use(authMiddleware);

// Chat routes
router.post("/send", sendMessage);
router.get("/history/:providerId", getChatHistory);
router.get("/notifications", getChatNotifications);
router.put("/notifications/:notificationId/read", markNotificationAsRead);
router.get("/list", getChatList);
router.post("/create", createOrGetChat);
router.post("/mark-read", markMessagesAsRead); // New route for marking messages as read

module.exports = router;
