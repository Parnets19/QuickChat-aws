const express = require("express");
const {
  createConsultation,
  getConsultation,
  getMyConsultations,
  startConsultation,
  endConsultation,
  cancelConsultation,
  rejectConsultation,
  getConsultationHistory,
  getGuestConsultationHistory,
  submitRating,
  getProviderRatings,
  addParticipantToConsultation,
  getConsultationParticipants,
} = require("../controllers/consultation.controller");
const { protect } = require("../middlewares/auth");

const router = express.Router();

router.use(protect);

router.post("/", createConsultation);
router.get("/", getMyConsultations);
router.get("/history", getConsultationHistory);
router.get("/guest-history", getGuestConsultationHistory);
// Test endpoint to verify code updates
router.get("/test-debug", (req, res) => {
  console.log("🚨 TEST ENDPOINT CALLED - Code is updated!");
  res.json({ message: "Debug endpoint working", timestamp: new Date() });
});

router.get("/:id", getConsultation);
router.put("/:id/start", startConsultation);
router.put("/:id/end", endConsultation);
router.put("/:id/cancel", cancelConsultation);

// Reject consultation (provider declines call)
router.put("/:id/reject", rejectConsultation);
router.post("/:id/rating", submitRating);

// Add participant to consultation
router.put("/:id/add-participant", addParticipantToConsultation);

// Get all participants with names — accessible to any call participant including conference invitees
router.get("/:id/participants", getConsultationParticipants);

// Public route for getting provider ratings
router.get("/provider/:providerId/ratings", getProviderRatings);

module.exports = router;
