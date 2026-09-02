const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { errorHandler } = require('./middlewares/errorHandler');
const { logger } = require('./utils/logger');
const { initializeSocket } = require('./socket');
const routes = require('./routes');

// Load environment variables from parent directory
dotenv.config({ path: require('path').join(__dirname, '..', '.env') });

// Initialize Express app
const app = express();
const httpServer = createServer(app);

// Ensure uploads directory exists
const fs = require('fs');
const path = require('path');
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  logger.info('✅ Created uploads directory at startup');
} else {
  logger.info('✅ Uploads directory exists');
}

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: function (origin, callback) {
      // Allow all origins for Socket.IO to fix iOS Safari issues
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'], // Support both transports for better compatibility
  allowEIO3: true, // Allow Engine.IO v3 clients
});

// Middleware
// app.use(helmet({
//   crossOriginResourcePolicy: { policy: "cross-origin" },
//   crossOriginEmbedderPolicy: false,
// }));

// CORS configuration - more permissive for production
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      process.env.ADMIN_URL || 'http://localhost:3001',
      'https://skill-quick-chats.netlify.app',
      'https://quickchatindia.com',
    ];
    
    // Allow any origin in development
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // Check if origin is allowed
    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('netlify.app')) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all for now to fix iOS Safari issue
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));
app.use(compression()); // Compress responses
app.use(express.json({ limit: '100mb' })); // Increase JSON payload limit
app.use(express.urlencoded({ extended: true, limit: '100mb' })); // Increase URL-encoded payload limit
app.use(mongoSanitize()); // Prevent MongoDB injection

// Initialize Socket.IO handlers
initializeSocket(io);

// Pass Socket.IO instance to billing controller for real-time updates
const { setSocketIO } = require('./controllers/realTimeBilling.controller');
setSocketIO(io);

// Live-stream billing needs io too: it reads socket-room membership to decide
// which viewers are actually watching, and emits wallet/earnings updates.
const {
  setSocketIO: setLiveStreamSocketIO,
} = require('./controllers/liveStream.controller');
setLiveStreamSocketIO(io);

// Make io accessible in req
app.set('io', io);

// Middleware to attach io to request object
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Static file serving for uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── Reel share page — serves OG meta + app store redirect for shared reel links
app.get('/reel/:reelId', async (req, res) => {
  const { reelId } = req.params;
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();

  // Detect social media crawlers/bots that need OG meta tags
  const isCrawler = /facebookexternalhit|twitterbot|whatsapp|telegrambot|linkedinbot|slackbot|discordbot|pinterestbot|googlebot|bingbot|yandexbot/i.test(userAgent);

  // If it's NOT a crawler, redirect to the web frontend which has a proper ReelPage
  if (!isCrawler) {
    // Let the SPA handle it — redirect to the frontend URL
    const buildPath = path.join(__dirname, '..', 'build');
    const indexPath = path.join(buildPath, 'index.html');
    const fs = require('fs');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    // Fallback if build doesn't exist (dev mode)
    return res.redirect(`https://quickchatindia.com/reel/${reelId}`);
  }

  // For crawlers: serve OG meta tags for rich link previews
  try {
    const Reel = require('./models/Reel.model');
    const User = require('./models/User.model');
    let title = 'Check out this video on QuickChat';
    let description = 'Watch amazing videos from top advisers on QuickChat';
    let videoUrl = '';
    let thumbUrl = 'https://quickchatindia.com/logo.png';

    // Try to fetch reel details for rich preview
    if (!reelId.startsWith('provider:')) {
      try {
        const reel = await Reel.findById(reelId).populate('user', 'fullName');
        if (reel) {
          title = reel.caption || title;
          description = `${reel.user?.fullName || 'QuickChat'}: ${reel.caption || ''}`;
          videoUrl = reel.videoUrl || '';
          thumbUrl = reel.thumbnailUrl || thumbUrl;
        }
      } catch {}
    } else {
      // Provider reel — try to get provider name
      try {
        const parts = reelId.split(':');
        const providerId = parts[1];
        if (providerId) {
          const provider = await User.findById(providerId).select('fullName profession');
          if (provider) {
            title = `${provider.fullName} on QuickChat`;
            description = `Watch ${provider.fullName}${provider.profession ? ' - ' + provider.profession : ''} on QuickChat`;
          }
        }
      } catch {}
    }

    const webLink = `https://quickchatindia.com/reel/${reelId}`;

    // Return minimal HTML with OG tags for crawlers
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${thumbUrl}">
  <meta property="og:url" content="${webLink}">
  <meta property="og:type" content="video.other">
  ${videoUrl ? `<meta property="og:video" content="${videoUrl}">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${thumbUrl}">
</head>
<body>
  <script>window.location.href = '${webLink}';</script>
</body>
</html>`);
  } catch (error) {
    res.redirect(`https://quickchatindia.com/reel/${reelId}`);
  }
});

// API Routes
app.use('/api', routes);

// Serve static files from build directory
const buildPath = path.join(__dirname, '..', 'build');
app.use(express.static(buildPath));

// Catch-all handler: send back React's index.html file for any non-API routes
app.get("*", (req, res) => {
  // Skip API routes
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  
  const indexPath = path.join(buildPath, 'index.html');
  
  // Check if index.html exists
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  } else {
    return res.status(404).json({ 
      error: 'Frontend build not found. Please ensure build directory exists with index.html',
      buildPath: buildPath 
    });
  }
});

// Error handling middleware
app.use(errorHandler);

// Database connection
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  // Auto-process completed consultations every 30 seconds
  const { autoProcessCompletedConsultations } = require('./auto_process_completed_consultations');
  setInterval(async () => {
    try {
      await autoProcessCompletedConsultations();
    } catch (error) {
      console.error('❌ Auto-processing error:', error);
    }
  }, 30000); // 30 seconds

  console.log('🔄 Auto-processing of completed consultations enabled (every 30 seconds)');

  // Server-authoritative live-stream billing. Charging used to depend entirely
  // on the viewer's client posting /process-billing every 60s, so a dead
  // interval meant the joiner watched for free.
  const {
    startLiveStreamBillingMonitor,
  } = require('./controllers/liveStream.controller');
  startLiveStreamBillingMonitor();

  httpServer.listen(PORT, () => {
    logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  });
};

startServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection:', err);
  httpServer.close(() => process.exit(1));
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

module.exports = { app, io };

