const express = require('express');
const { getIceServers } = require('../controllers/turn.controller');
const { protect } = require('../middlewares/auth');

const router = express.Router();

// GET /api/turn/ice-servers - Get ICE/TURN server credentials (protected)
router.get('/ice-servers', protect, getIceServers);

module.exports = router;
