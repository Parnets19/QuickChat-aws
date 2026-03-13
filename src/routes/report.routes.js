const express = require('express');
const router = express.Router();
const {
  submitReport,
  getAllReports,
  getUserReports,
  takeActionOnReport,
  getBlockedUsers,
  unblockUser,
} = require('../controllers/report.controller');
const { protect, adminProtect } = require('../middlewares/auth');

// User routes
router.post('/', protect, submitReport);
router.get('/blocked', protect, getBlockedUsers);
router.delete('/blocked/:userId', protect, unblockUser);

// Admin routes
router.get('/', protect, adminProtect, getAllReports);
router.get('/user/:userId', protect, adminProtect, getUserReports);
router.put('/:id/action', protect, adminProtect, takeActionOnReport);

module.exports = router;
