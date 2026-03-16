const express = require("express");
const { protect } = require("../middlewares/auth");
const { upload } = require("../middlewares/upload");
const {
  sendMessage,
  sendFileMessage,
  getChatHistory,
  getChatNotifications,
  markNotificationAsRead,
  getChatList,
  createOrGetChat,
  markMessagesAsRead,
} = require("../controllers/chat.controller");

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// Chat routes
router.post("/send", sendMessage);
router.post("/send-file", upload.single("file"), sendFileMessage);
router.get("/history/:providerId", getChatHistory);
router.get("/notifications", getChatNotifications);
router.put("/notifications/:notificationId/read", markNotificationAsRead);
router.get("/list", getChatList);
router.post("/create", createOrGetChat);
router.post("/mark-read", markMessagesAsRead);

module.exports = router;
