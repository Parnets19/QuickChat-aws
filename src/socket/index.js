const jwt = require('jsonwebtoken');
const { User, Consultation } = require('../models');
const { logger } = require('../utils/logger');

const onlineUsers = new Map(); // userId -> socketIds[]

const initializeSocket = (io) => {
  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      console.log('Socket authentication attempt from:', socket.handshake.address);
      const token = socket.handshake.auth.token;

      if (!token) {
        console.log('Socket authentication failed: No token provided');
        return next(new Error('Authentication error: No token provided'));
      }

      console.log('Socket token received, length:', token.length);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Socket token decoded successfully for user:', decoded.id);
      
      const user = await User.findById(decoded.id);

      if (!user) {
        console.log('Socket authentication failed: User not found for ID:', decoded.id);
        return next(new Error('User not found'));
      }

      console.log('Socket authentication successful for user:', user.fullName);
      socket.data.userId = user._id.toString();
      socket.data.user = user;
      next();
    } catch (error) {
      console.error('Socket authentication error:', error.message);
      next(new Error('Authentication error: ' + error.message));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    const userName = socket.data.user?.fullName || 'Unknown';
    console.log(`Socket connection established for user: ${userName} (${userId})`);
    logger.info(`User connected: ${userId}`);

    // Add user to online users
    if (onlineUsers.has(userId)) {
      onlineUsers.get(userId).push(socket.id);
    } else {
      onlineUsers.set(userId, [socket.id]);
    }

    // Update user online status
    User.findByIdAndUpdate(userId, { isOnline: true, lastActive: new Date() }).exec();

    // Send online status to all connections
    socket.broadcast.emit('user:online', { userId });

    // Join user's personal room
    socket.join(`user:${userId}`);

    // Handle consultation join
    socket.on('consultation:join', async (data) => {
      try {
        const consultation = await Consultation.findById(data.consultationId);

        if (!consultation) {
          socket.emit('error', { message: 'Consultation not found' });
          return;
        }

        // Check if user is part of consultation
        if (
          consultation.user.toString() !== userId &&
          consultation.provider.toString() !== userId
        ) {
          socket.emit('error', { message: 'Unauthorized' });
          return;
        }

        // Check if user is already in the room to prevent duplicates
        const room = io.sockets.adapter.rooms.get(`consultation:${data.consultationId}`);
        const isAlreadyInRoom = room && Array.from(room).includes(socket.id);
        
        if (isAlreadyInRoom) {
          console.log(`User ${userId} already in consultation room, skipping duplicate join`);
          return;
        }

        socket.join(`consultation:${data.consultationId}`);
        
        // Get updated room info after joining
        const updatedRoom = io.sockets.adapter.rooms.get(`consultation:${data.consultationId}`);
        const participantCount = updatedRoom ? updatedRoom.size : 1;
        
        // Determine user role
        const isProvider = consultation.provider.toString() === userId;
        
        console.log('User joined consultation:', {
          userId: userId,
          consultationId: data.consultationId,
          isProvider: isProvider,
          participantCount: participantCount,
          socketId: socket.id
        });
        
        socket.emit('consultation:joined', { 
          consultationId: data.consultationId,
          isProvider: isProvider,
          participantCount: participantCount
        });

        // Only notify others if this is a new join (not a duplicate)
        socket.to(`consultation:${data.consultationId}`).emit('participant:joined', {
          userId: userId,
          isProvider: isProvider,
          participantCount: participantCount
        });

        logger.info(`User ${userId} joined consultation ${data.consultationId} as ${isProvider ? 'provider' : 'client'} (${participantCount} total participants)`);
      } catch (error) {
        console.error('Error in consultation join:', error);
        socket.emit('error', { message: 'Failed to join consultation' });
      }
    });

    // Handle consultation start
    socket.on('consultation:start', async (data) => {
      try {
        const consultation = await Consultation.findById(data.consultationId);

        if (!consultation || consultation.provider.toString() !== userId) {
          socket.emit('error', { message: 'Unauthorized' });
          return;
        }

        consultation.status = 'ongoing';
        consultation.startTime = new Date();
        await consultation.save();

        io.to(`consultation:${data.consultationId}`).emit('consultation:started', {
          consultationId: data.consultationId,
          startTime: consultation.startTime,
        });

        logger.info(`Consultation started: ${data.consultationId}`);
      } catch (error) {
        socket.emit('error', { message: 'Failed to start consultation' });
      }
    });

    // Handle chat message
    socket.on('consultation:message', async (data) => {
      try {
        const consultation = await Consultation.findById(data.consultationId);

        if (!consultation) {
          socket.emit('error', { message: 'Consultation not found' });
          return;
        }

        // Check if user is part of consultation
        if (
          consultation.user.toString() !== userId &&
          consultation.provider.toString() !== userId
        ) {
          socket.emit('error', { message: 'Unauthorized' });
          return;
        }

        const messageData = {
          sender: userId,
          message: data.message,
          timestamp: new Date(),
          type: data.type || 'text',
        };

        consultation.messages.push(messageData);
        await consultation.save();

        io.to(`consultation:${data.consultationId}`).emit('consultation:message', messageData);

        logger.info(`Message sent in consultation ${data.consultationId}`);
      } catch (error) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle consultation end
    socket.on('consultation:end', async (data) => {
      try {
        console.log(`User ${userId} is ending consultation ${data.consultationId}`);
        
        const consultation = await Consultation.findById(data.consultationId);

        if (!consultation) {
          socket.emit('error', { message: 'Consultation not found' });
          return;
        }

        // Either party can end the consultation
        if (
          consultation.user.toString() !== userId &&
          consultation.provider.toString() !== userId
        ) {
          socket.emit('error', { message: 'Unauthorized' });
          return;
        }

        // Only update if consultation is ongoing (not pending or already completed)
        if (consultation.status === 'ongoing') {
          consultation.status = 'completed';
          consultation.endTime = new Date();

          // Calculate duration in minutes
          if (consultation.startTime) {
            const duration = Math.ceil(
              (consultation.endTime.getTime() - consultation.startTime.getTime()) / (1000 * 60)
            );
            consultation.duration = duration;
            consultation.totalAmount = duration * consultation.rate;
          }

          await consultation.save();
          console.log(`Consultation ${data.consultationId} marked as completed`);
        } else {
          console.log(`Cannot end consultation ${data.consultationId} - current status: ${consultation.status}`);
        }

        // Notify ALL participants in the consultation room that it has ended
        console.log(`Broadcasting consultation end to room: consultation:${data.consultationId}`);
        io.to(`consultation:${data.consultationId}`).emit('consultation:ended', {
          consultationId: data.consultationId,
          endTime: consultation.endTime,
          duration: consultation.duration,
          totalAmount: consultation.totalAmount,
          endedBy: userId
        });

        // Force disconnect all sockets in this consultation room
        const room = io.sockets.adapter.rooms.get(`consultation:${data.consultationId}`);
        if (room) {
          console.log(`Force disconnecting ${room.size} clients from consultation room`);
          room.forEach(socketId => {
            const clientSocket = io.sockets.sockets.get(socketId);
            if (clientSocket) {
              clientSocket.leave(`consultation:${data.consultationId}`);
              console.log(`Removed socket ${socketId} from consultation room`);
            }
          });
        }

        logger.info(`Consultation ended by user ${userId}: ${data.consultationId}`);
      } catch (error) {
        console.error('Error ending consultation:', error);
        socket.emit('error', { message: 'Failed to end consultation' });
      }
    });

    // Handle WebRTC signaling for audio/video calls
    socket.on('webrtc:offer', (data, callback) => {
      try {
        console.log(`WebRTC offer from user ${userId} for consultation ${data.consultationId}`);
        
        // Get room info to check if other party is connected
        const room = io.sockets.adapter.rooms.get(`consultation:${data.consultationId}`);
        const participantCount = room ? room.size : 0;
        
        if (participantCount < 2) {
          console.log(`Not enough participants in consultation ${data.consultationId} (${participantCount})`);
          if (callback) callback({ success: false, error: 'No other participant connected' });
          return;
        }
        
        socket.to(`consultation:${data.consultationId}`).emit('webrtc:offer', {
          offer: data.offer,
          from: userId,
        });
        
        console.log(`WebRTC offer forwarded successfully for consultation ${data.consultationId}`);
        if (callback) callback({ success: true });
        
      } catch (error) {
        console.error('Error handling WebRTC offer:', error);
        if (callback) callback({ success: false, error: error.message });
      }
    });

    socket.on('webrtc:answer', (data, callback) => {
      try {
        console.log(`WebRTC answer from user ${userId} for consultation ${data.consultationId}`);
        
        socket.to(`consultation:${data.consultationId}`).emit('webrtc:answer', {
          answer: data.answer,
          from: userId,
        });
        
        console.log(`WebRTC answer forwarded successfully for consultation ${data.consultationId}`);
        if (callback) callback({ success: true });
        
      } catch (error) {
        console.error('Error handling WebRTC answer:', error);
        if (callback) callback({ success: false, error: error.message });
      }
    });

    socket.on('webrtc:ice-candidate', (data, callback) => {
      try {
        console.log(`ICE candidate from user ${userId} for consultation ${data.consultationId}`);
        
        socket.to(`consultation:${data.consultationId}`).emit('webrtc:ice-candidate', {
          candidate: data.candidate,
          from: userId,
        });
        
        if (callback) callback({ success: true });
        
      } catch (error) {
        console.error('Error handling ICE candidate:', error);
        if (callback) callback({ success: false, error: error.message });
      }
    });

    // Handle typing indicator
    socket.on('typing:start', (data) => {
      socket.to(`consultation:${data.consultationId}`).emit('typing:start', { userId });
    });

    socket.on('typing:stop', (data) => {
      socket.to(`consultation:${data.consultationId}`).emit('typing:stop', { userId });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      logger.info(`User disconnected: ${userId}`);

      // Remove socket from user's socket list
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        const index = userSockets.indexOf(socket.id);
        if (index > -1) {
          userSockets.splice(index, 1);
        }

        // If no more sockets for this user, mark as offline
        if (userSockets.length === 0) {
          onlineUsers.delete(userId);
          User.findByIdAndUpdate(userId, { isOnline: false, lastActive: new Date() }).exec();
          socket.broadcast.emit('user:offline', { userId });
        }
      }
    });
  });
};

const getOnlineUsers = () => {
  return Array.from(onlineUsers.keys());
};

const isUserOnline = (userId) => {
  return onlineUsers.has(userId);
};

module.exports = {
  initializeSocket,
  getOnlineUsers,
  isUserOnline,
};

