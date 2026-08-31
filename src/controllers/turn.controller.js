/**
 * TURN Server Credentials Controller
 * Serves ICE server configuration (STUN + TURN) to frontend clients.
 * Credentials are read from environment variables so they're not hardcoded in frontend.
 */

const getIceServers = async (req, res) => {
  try {
    const turnIp = process.env.TURN_SERVER_IP;
    const turnPort = process.env.TURN_SERVER_PORT || '3478';
    const turnUsername = process.env.TURN_SERVER_USERNAME;
    const turnCredential = process.env.TURN_SERVER_CREDENTIAL;

    if (!turnIp || !turnUsername || !turnCredential) {
      console.error('❌ TURN server environment variables not configured');
      // Fallback to STUN-only if TURN not configured
      return res.status(200).json({
        success: true,
        data: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ]
        }
      });
    }

    // Allow enabling TURNS (TURN over TLS, port 5349) only when it's actually
    // running. Advertising an unreachable TURNS URL makes clients spend several
    // seconds trying to connect to it before giving up — a major cause of slow
    // call setup. Default OFF; set TURN_ENABLE_TLS=true once 5349 is confirmed up.
    const enableTurns = String(process.env.TURN_ENABLE_TLS).toLowerCase() === 'true';
    const turnsPort = process.env.TURN_TLS_PORT || '5349';

    const iceServers = [
      // STUN servers (free, for direct connections)
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // Self-hosted TURN server (for NAT traversal - WiFi/4G cross-network).
      // UDP is listed FIRST so clients prefer UDP relay (lowest latency, smoothest
      // media); TCP is the fallback for networks that block UDP.
      {
        urls: [
          `turn:${turnIp}:${turnPort}?transport=udp`,
          `turn:${turnIp}:${turnPort}?transport=tcp`,
        ],
        username: turnUsername,
        credential: turnCredential,
      },
    ];

    // Only advertise TURNS when explicitly enabled (and reachable). Otherwise the
    // client wastes time on a dead 5349 candidate.
    if (enableTurns) {
      iceServers.push({
        urls: `turns:${turnIp}:${turnsPort}?transport=tcp`,
        username: turnUsername,
        credential: turnCredential,
      });
    }

    res.status(200).json({
      success: true,
      data: { iceServers }
    });
  } catch (error) {
    console.error('❌ Error serving ICE servers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get ICE server configuration'
    });
  }
};

module.exports = { getIceServers };
