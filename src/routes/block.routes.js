const express = require("express");
const { protect } = require("../middlewares/auth");
const {
  blockUser,
  unblockUser,
  getBlockedUsers,
  reportUser,
  checkBlockStatus,
} = require("../controllers/block.controller");

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// Block/Unblock routes
router.post("/block/:userId", blockUser);
router.delete("/block/:userId", unblockUser);
router.get("/blocked", getBlockedUsers);
router.get("/block/check/:userId", checkBlockStatus);

// Report route
router.post("/report/:userId", reportUser);

module.exports = router;
