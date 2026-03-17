const express = require('express');
const router = express.Router();
const {
  startChat,
  sendMessage,
  getChatHistory,
  getMyChat,
  getAllChats,
  adminReply,
  updateChatStatus,
} = require('../controllers/support.controller');
const { protect, adminOnly, optionalProtect } = require('../middlewares/auth');

// Public / user routes
router.post('/chat', optionalProtect, startChat);                         // Start or get chat (auth optional)
router.post('/chat/:chatId/message', optionalProtect, sendMessage);       // Send message
router.get('/chat/:chatId', optionalProtect, getChatHistory);             // Get chat history
router.get('/my-chat', protect, getMyChat);                               // Logged-in user's chat

// Admin routes
router.get('/admin/chats', protect, adminOnly, getAllChats);
router.post('/admin/chats/:chatId/reply', protect, adminOnly, adminReply);
router.put('/admin/chats/:chatId/status', protect, adminOnly, updateChatStatus);

module.exports = router;
