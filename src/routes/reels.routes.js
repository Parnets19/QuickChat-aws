const express = require('express');
const {
  createReel,
  getReels,
  getReel,
  toggleLikeReel,
  addComment,
  getReelComments,
  incrementReelViews,
  incrementReelShares,
  getUserReels,
  deleteReel,
} = require('../controllers/reels.controller');
const { protect, optionalProtect } = require('../middlewares/auth');

const router = express.Router();

router.route('/')
  .get(optionalProtect, getReels)
  .post(protect, createReel);

router.route('/user/:userId')
  .get(getUserReels);

router.route('/:id')
  .get(getReel)
  .delete(protect, deleteReel);

router.route('/:id/like')
  .put(protect, toggleLikeReel);

router.route('/:id/comments')
  .post(protect, addComment)
  .get(getReelComments);

router.route('/:id/view')
  .put(incrementReelViews);

router.route('/:id/share')
  .put(incrementReelShares);

module.exports = router;
