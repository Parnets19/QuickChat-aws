const express = require('express');
const {
  getWalletOverview,
  getProviderWallets,
  getGuestWallets,
  getAllTransactions,
  getAllWithdrawals,
  exportWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  processWithdrawal
} = require('../controllers/adminWallet.controller');
const { protect, adminOnly } = require('../middlewares/auth');

const router = express.Router();

// Apply authentication and admin-only middleware to all routes
router.use(protect);
router.use(adminOnly);

// Wallet overview and management
router.get('/overview', getWalletOverview);
router.get('/providers', getProviderWallets);
router.get('/guests', getGuestWallets);

// Transaction management
router.get('/transactions', getAllTransactions);

// Withdrawal management
router.get('/withdrawals', getAllWithdrawals);
// Excel-openable CSV export with full bank details, for bulk bank transfers.
// Declared before '/withdrawals/:id/...' routes; it is a GET so there is no
// clash, but keeping it adjacent to the list route keeps the intent obvious.
router.get('/withdrawals/export', exportWithdrawals);
router.put('/withdrawals/:id/approve', approveWithdrawal);
router.put('/withdrawals/:id/reject', rejectWithdrawal);
router.put('/withdrawals/:id/process', processWithdrawal);

module.exports = router;