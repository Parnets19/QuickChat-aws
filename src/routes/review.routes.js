const express = require('express');
const {
  createReview,
  getProviderReviews,
  getGuestReviews,
  reportReview,
  deleteReview,
} = require('../controllers/review.controller');
const { protect } = require('../middlewares/auth');

const router = express.Router();

// Public routes
router.get('/provider/:providerId', getProviderReviews);
router.get('/guest/:guestId', getGuestReviews);

// Private routes
router.use(protect);
router.post('/', createReview);
router.post('/:id/report', reportReview);
router.delete('/:id', deleteReview);

module.exports = router;

