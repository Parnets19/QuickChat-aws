const express = require("express");
const {
  createConsultation,
  getConsultation,
  getMyConsultations,
  startConsultation,
  endConsultation,
  cancelConsultation,
  getConsultationHistory,
} = require("../controllers/consultation.controller");
const { protect } = require("../middlewares/auth");

const router = express.Router();

router.use(protect);

router.post("/", createConsultation);
router.get("/", getMyConsultations);
router.get("/history", getConsultationHistory);
// Test endpoint to verify code updates
router.get("/test-debug", (req, res) => {
  console.log("🚨 TEST ENDPOINT CALLED - Code is updated!");
  res.json({ message: "Debug endpoint working", timestamp: new Date() });
});

router.get("/:id", getConsultation);
router.put("/:id/start", startConsultation);
router.put("/:id/end", endConsultation);
router.put("/:id/cancel", cancelConsultation);

module.exports = router;
