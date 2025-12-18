const express = require('express');
const {
  getWalletBalance,
  addMoneyToWallet,
  withdrawFromWallet,
  getTransactionHistory,
  payForConsultation
} = require('../controllers/guestWallet.controller');
const { guestAuth } = require('../middlewares/auth');

const router = express.Router();

// All routes require guest authentication
router.use(guestAuth);

// Wallet routes
router.get('/balance', getWalletBalance);
router.post('/add-money', addMoneyToWallet);
router.post('/withdraw', withdrawFromWallet);
router.get('/transactions', getTransactionHistory);
router.post('/pay-consultation', payForConsultation);

module.exports = router;