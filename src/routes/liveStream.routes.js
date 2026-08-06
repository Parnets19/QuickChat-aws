const express = require("express");
const {
  startLiveStream,
  endLiveStream,
  joinLiveStream,
  leaveLiveStream,
  getLiveStreams,
  getLiveStream,
  getLiveStreamHistory,
  markViewerConnected,
  processLiveStreamBilling,
} = require("../controllers/liveStream.controller");
const { protect } = require("../middlewares/auth");

const router = express.Router();

// Public routes
router.get("/", getLiveStreams);

// Protected routes (require authentication)
router.use(protect);
// History must be registered BEFORE "/:id" to avoid Express treating "history" as an id param
router.get("/history", getLiveStreamHistory);
router.get("/:id", getLiveStream);
router.post("/start", startLiveStream);
router.put("/:id/end", endLiveStream);
router.post("/:id/join", joinLiveStream);
router.post("/:id/leave", leaveLiveStream);
router.post("/:id/viewer-connected", markViewerConnected);
router.post("/:id/process-billing", processLiveStreamBilling);

module.exports = router;
