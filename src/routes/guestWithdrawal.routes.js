const express = require('express');
const router = express.Router();
const guestWithdrawalController = require('../controllers/guestWithdrawal.controller');
const { guestAuth } = require('../middlewares/auth');

// Apply guest authentication to all routes
router.use(guestAuth);

// Guest withdrawal routes
router.post('/request', guestWithdrawalController.requestWithdrawal);
router.get('/history', guestWithdrawalController.getWithdrawalHistory);
router.get('/wallet', guestWithdrawalController.getWalletOverview);
router.put('/cancel/:withdrawalId', guestWithdrawalController.cancelWithdrawal);

module.exports = router;