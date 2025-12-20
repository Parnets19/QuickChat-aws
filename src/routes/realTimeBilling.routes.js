const express = require('express');
const {
  checkConsultationAffordability,
  startConsultation,
  acceptCall,
  processRealTimeBilling,
  endConsultation,
  getConsultationStatus,
  checkOngoingConsultations
} = require('../controllers/realTimeBilling.controller');
const { protect } = require('../middlewares/auth');

const router = express.Router();

// All routes require authentication
router.use(protect);

// POST /api/billing/check-affordability - Check if user can afford consultation
router.post('/check-affordability', checkConsultationAffordability);

// POST /api/billing/start - Start consultation with real-time billing
router.post('/start', startConsultation);

// POST /api/billing/accept - Provider accepts the call (starts billing when both sides accept)
router.post('/accept', acceptCall);

// POST /api/billing/bill-minute - Process per-minute billing (called every minute)
router.post('/bill-minute', processRealTimeBilling);

// POST /api/billing/end - End consultation manually
router.post('/end', endConsultation);

// GET /api/billing/status/:consultationId - Get consultation status
router.get('/status/:consultationId', getConsultationStatus);

// GET /api/billing/ongoing - Check for ongoing consultations
router.get('/ongoing', checkOngoingConsultations);

module.exports = router;