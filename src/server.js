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

// Load environment variables
dotenv.config();

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
      'https://skillhub-a00h.onrender.com',
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
app.use(express.json());
app.use(express.urlencoded({ extended: true}));
app.use(mongoSanitize()); // Prevent MongoDB injection

// Initialize Socket.IO handlers
initializeSocket(io);

// Pass Socket.IO instance to billing controller for real-time updates
const { setSocketIO } = require('./controllers/realTimeBilling.controller');
setSocketIO(io);

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
app.use('/uploads', express.static('uploads'));

// API Routes
app.use('/api', routes);

// Welcome route (only for root path)
app.get('/', (req, res) => {
  res.status(200).json({message:"Welcome to Quick Chat api"});
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

