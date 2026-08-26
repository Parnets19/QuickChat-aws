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

    const iceServers = [
      // STUN servers (free, for direct connections)
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // Self-hosted TURN server (for NAT traversal - WiFi/4G cross-network)
      {
        urls: [
          `turn:${turnIp}:${turnPort}?transport=udp`,
          `turn:${turnIp}:${turnPort}?transport=tcp`,
        ],
        username: turnUsername,
        credential: turnCredential,
      },
      // TURNS (TURN over TLS on port 5349) for restrictive networks
      {
        urls: `turns:${turnIp}:5349?transport=tcp`,
        username: turnUsername,
        credential: turnCredential,
      },
    ];

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
