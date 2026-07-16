const express = require('express');
const { protect } = require('../middlewares/auth');
const {
  followUser,
  unfollowUser,
  getFollowStatus,
  getFollowing,
  getBulkFollowStatus,
} = require('../controllers/follow.controller');

const router = express.Router();

router.use(protect); // all follow routes require auth

router.post('/bulk-status', getBulkFollowStatus);
router.get('/following', getFollowing);
router.post('/:id', followUser);
router.delete('/:id', unfollowUser);
router.get('/:id/status', getFollowStatus);

module.exports = router;
