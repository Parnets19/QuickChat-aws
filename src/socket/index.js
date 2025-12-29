const jwt = require('jsonwebtoken');
const { User, Guest, Consultation } = require('../models');
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
      
      // Handle guest users
      if (decoded.isGuest) {
        // Fetch guest details from database
        const guest = await Guest.findById(decoded.id);
        if (!guest) {
          console.log('Socket authentication failed: Guest not found for ID:', decoded.id);
          return next(new Error('Guest not found'));
        }
        
        console.log('Socket authentication successful for guest user:', guest.name);
        socket.data.userId = decoded.id;
        socket.data.user = {
          _id: decoded.id,
          fullName: guest.name,
          mobile: guest.mobile,
          isGuest: true,
          isServiceProvider: false
        };
        return next();
      }
      
      // Handle regular users
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

    // Update user online status (only for regular users, not guests)
    if (!socket.data.user?.isGuest) {
      User.findByIdAndUpdate(userId, { isOnline: true, lastActive: new Date() }).exec();
    }

    // Send online status to all connections
    socket.broadcast.emit('user:online', { userId, consultationStatus: socket.data.user?.consultationStatus || 'available' });

    // Join user's personal room for global notifications
    socket.join(`user:${userId}`);
    console.log(`User ${userId} joined personal room: user:${userId}`);

    // Handle consultation join with duplicate prevention
    socket.on('consultation:join', async (data) => {
      try {
        const consultation = await Consultation.findById(data.consultationId);

        if (!consultation) {
          socket.emit('error', { message: 'Consultation not found' });
          return;
        }

        // Check if user is part of consultation (handle guest users)
        const consultationUserId = typeof consultation.user === 'string' ? consultation.user : consultation.user.toString();
        const consultationProviderId = consultation.provider.toString();
        
        if (consultationUserId !== userId && consultationProviderId !== userId) {
          socket.emit('error', { message: 'Unauthorized' });
          return;
        }

        // Check if user is already in the room to prevent duplicates
        const room = io.sockets.adapter.rooms.get(`consultation:${data.consultationId}`);
        const isAlreadyInRoom = room && Array.from(room).includes(socket.id);
        
        if (isAlreadyInRoom) {
          console.log(`User ${userId} already in consultation room, skipping duplicate join`);
          // Still send confirmation but don't notify others
          const isProvider = consultationProviderId === userId;
          socket.emit('consultation:joined', { 
            consultationId: data.consultationId,
            isProvider: isProvider,
            participantCount: room.size
          });
          return;
        }

        socket.join(`consultation:${data.consultationId}`);
        
        // Get updated room info after joining
        const updatedRoom = io.sockets.adapter.rooms.get(`consultation:${data.consultationId}`);
        const participantCount = updatedRoom ? updatedRoom.size : 1;
        
        // Determine user role - handle provider-to-provider consultations
        let isProvider = consultationProviderId === userId;
        
        // For provider-to-provider consultations, use consultation-specific roles
        if (consultation.isProviderToProvider) {
          console.log(`🔍 SOCKET DEBUG - Provider-to-provider consultation detected`);
          
          // Check consultation-specific role from participantRoles
          if (consultation.participantRoles) {
            if (consultationUserId === userId) {
              // This is the booking provider (user field) - they are the client in this consultation
              isProvider = consultation.participantRoles.bookingProvider === 'provider';
              console.log(`🔍 SOCKET DEBUG - Booking provider role: ${consultation.participantRoles.bookingProvider}`);
            } else if (consultationProviderId === userId) {
              // This is the booked provider (provider field) - they are the provider in this consultation
              isProvider = consultation.participantRoles.bookedProvider === 'provider';
              console.log(`🔍 SOCKET DEBUG - Booked provider role: ${consultation.participantRoles.bookedProvider}`);
            }
          }
          
          console.log(`🔍 SOCKET DEBUG - Provider-to-provider role determination:`, {
            userId,
            consultationUserId,
            consultationProviderId,
            finalIsProvider: isProvider,
            bookingProviderRole: consultation.participantRoles?.bookingProvider,
            bookedProviderRole: consultation.participantRoles?.bookedProvider
          });
        }
        
        console.log(`✅ User joined consultation: ${userId} as ${isProvider ? 'provider' : 'client'} (${participantCount} participants)`);
        
        socket.emit('consultation:joined', { 
          consultationId: data.consultationId,
          isProvider: isProvider,
          participantCount: participantCount,
          isProviderToProvider: consultation.isProviderToProvider || false
        });

        // Only notify others if this is a new join and there are other participants
        if (participantCount > 1) {
          socket.to(`consultation:${data.consultationId}`).emit('participant:joined', {
            userId: userId,
            isProvider: isProvider,
            participantCount: participantCount
          });
        }

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

        // Mark provider as busy for all consultation types
        await User.findByIdAndUpdate(consultation.provider, {
          consultationStatus: 'busy',
          isInCall: true,
          currentConsultationId: consultation._id,
        });

        io.to(`consultation:${data.consultationId}`).emit('consultation:started', {
          consultationId: data.consultationId,
          startTime: consultation.startTime,
        });

        logger.info(`Consultation started: ${data.consultationId}`);
      } catch (error) {
        socket.emit('error', { message: 'Failed to start consultation' });
      }
    });

    // Handle incoming call notification (ring system)
    // NOTE: Ring notifications are now handled by real-time billing controller
    // This socket handler is disabled to prevent duplicate notifications
    socket.on('consultation:ring', async (data) => {
      console.log('⚠️ DEPRECATED: consultation:ring event received - notifications now handled by real-time billing controller');
      console.log('📋 Consultation ID:', data.consultationId);
      console.log('💡 Ring notifications are sent automatically when consultation starts via real-time billing');
      
      // This handler is intentionally disabled to prevent duplicate notifications
      // The real-time billing controller now handles all incoming call notifications
    });

    // Handle chat message
    socket.on('consultation:message', async (data) => {
      try {
        console.log('📨 BACKEND: Received message data:', data);
        console.log('📨 BACKEND: Message type:', data.type);
        console.log('📨 BACKEND: Has file:', !!data.file);
        if (data.file) {
          console.log('📨 BACKEND: File details:', data.file);
        }

        const consultation = await Consultation.findById(data.consultationId);

        if (!consultation) {
          console.log('❌ BACKEND: Consultation not found:', data.consultationId);
          socket.emit('error', { message: 'Consultation not found' });
          return;
        }

        // Check if user is part of consultation (handle guest users)
        const consultationUserId = typeof consultation.user === 'string' ? consultation.user : consultation.user.toString();
        const consultationProviderId = consultation.provider.toString();
        
        if (consultationUserId !== userId && consultationProviderId !== userId) {
          console.log('❌ BACKEND: Unauthorized user:', userId);
          socket.emit('error', { message: 'Unauthorized' });
          return;
        }

        const messageData = {
          sender: userId,
          message: data.message,
          timestamp: new Date(),
          type: data.type || 'text',
          file: data.file || null, // Include file data for file messages
        };

        console.log('📨 BACKEND: Saving message data:', messageData);

        consultation.messages.push(messageData);
        await consultation.save();

        console.log('📨 BACKEND: Broadcasting message to room:', `consultation:${data.consultationId}`);
        console.log('📨 BACKEND: Message data being broadcast:', messageData);

        io.to(`consultation:${data.consultationId}`).emit('consultation:message', messageData);

        logger.info(`Message sent in consultation ${data.consultationId} - Type: ${messageData.type}, Has file: ${!!messageData.file}`);
      } catch (error) {
        console.error('❌ BACKEND: Error handling message:', error);
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

        // Either party can end the consultation (handle guest users)
        const consultationUserId = typeof consultation.user === 'string' ? consultation.user : consultation.user.toString();
        const consultationProviderId = consultation.provider.toString();
        
        if (consultationUserId !== userId && consultationProviderId !== userId) {
          socket.emit('error', { message: 'Unauthorized' });
          return;
        }

        // Only update if consultation is ongoing (not pending, already completed, or auto-cancelled)
        // Don't override statuses like 'no_answer', 'cancelled', 'missed' that were set by system
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
        } else if (['no_answer', 'cancelled', 'missed'].includes(consultation.status)) {
          console.log(`⚠️ Not overriding consultation status '${consultation.status}' - keeping system-set status`);
          // Don't change the status, but still update provider availability
        }

        // Mark provider as no longer busy
        // Check if provider has any other ongoing consultations
        const ongoingConsultations = await Consultation.countDocuments({
          provider: consultation.provider,
          status: 'ongoing',
          _id: { $ne: consultation._id } // Exclude current consultation
        });
        
        const newStatus = ongoingConsultations > 0 ? 'busy' : 'available';
        
        await User.findByIdAndUpdate(consultation.provider, {
          consultationStatus: newStatus,
          isInCall: ongoingConsultations > 0,
          currentConsultationId: ongoingConsultations > 0 ? consultation.currentConsultationId : null,
        });
        
        console.log(`📱 Provider ${consultation.provider} status updated to: ${newStatus} (${ongoingConsultations} ongoing consultations)`);

        await consultation.save();
        console.log(`Consultation ${data.consultationId} status: ${consultation.status}`);

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
        // Get room info to check if other party is connected
        const room = io.sockets.adapter.rooms.get(`consultation:${data.consultationId}`);
        const participantCount = room ? room.size : 0;
        const roomMembers = room ? Array.from(room) : [];
        
        console.log(`📞 WebRTC offer received from ${userId} for consultation ${data.consultationId}`);
        console.log(`📊 Room info: ${participantCount} participants, socket IDs: ${roomMembers.join(', ')}`);
        
        // Log if this is an upgrade offer
        if (data.isUpgrade) {
          console.log(`📹 BACKEND: Video upgrade offer detected from ${userId}`);
        }
        
        if (participantCount < 2) {
          console.log(`⚠️ Cannot forward offer - only ${participantCount} participant(s) in room`);
          if (callback) callback({ success: false, error: 'No other participant connected' });
          return;
        }
        
        // Get list of socket IDs in room (excluding sender)
        const recipientSockets = roomMembers.filter(id => id !== socket.id);
        console.log(`📤 Broadcasting offer to ${recipientSockets.length} recipient(s): ${recipientSockets.join(', ')}`);
        
        socket.to(`consultation:${data.consultationId}`).emit('webrtc:offer', {
          offer: data.offer,
          from: userId,
          consultationId: data.consultationId, // Include consultationId for verification
          isUpgrade: data.isUpgrade, // Forward the upgrade flag
        });
        
        console.log(`✅ WebRTC offer forwarded to room consultation:${data.consultationId} (${participantCount} total, ${recipientSockets.length} recipients)`);
        if (callback) callback({ success: true });
        
      } catch (error) {
        console.error('Error handling WebRTC offer:', error);
        if (callback) callback({ success: false, error: error.message });
      }
    });

    socket.on('webrtc:answer', (data, callback) => {
      try {
        const room = io.sockets.adapter.rooms.get(`consultation:${data.consultationId}`);
        const participantCount = room ? room.size : 0;
        const roomMembers = room ? Array.from(room) : [];
        const recipientSockets = roomMembers.filter(id => id !== socket.id);
        
        console.log(`📞 WebRTC answer received from ${userId} for consultation ${data.consultationId}`);
        console.log(`📊 Room info: ${participantCount} participants, broadcasting to ${recipientSockets.length} recipient(s)`);
        
        // Log if this is an upgrade answer
        if (data.isUpgrade) {
          console.log(`📹 BACKEND: Video upgrade answer detected from ${userId}`);
        }
        
        socket.to(`consultation:${data.consultationId}`).emit('webrtc:answer', {
          answer: data.answer,
          from: userId,
          consultationId: data.consultationId, // Include consultationId for verification
          isUpgrade: data.isUpgrade, // Forward the upgrade flag
        });
        
        console.log(`✅ WebRTC answer forwarded to room consultation:${data.consultationId} (${recipientSockets.length} recipient(s))`);
        if (callback) callback({ success: true });
        
      } catch (error) {
        console.error('Error handling WebRTC answer:', error);
        if (callback) callback({ success: false, error: error.message });
      }
    });

    socket.on('webrtc:ice-candidate', (data, callback) => {
      try {
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

    // Handle video upgrade notification
    socket.on('consultation:upgrade-to-video', (data) => {
      try {
        console.log(`📹 User ${userId} is upgrading consultation ${data.consultationId} to video`);
        
        // Broadcast upgrade notification to other participants
        socket.to(`consultation:${data.consultationId}`).emit('consultation:upgrade-to-video', {
          from: userId,
          consultationId: data.consultationId,
        });
        
        logger.info(`Video upgrade initiated by user ${userId} in consultation ${data.consultationId}`);
      } catch (error) {
        console.error('Error handling video upgrade:', error);
        socket.emit('error', { message: 'Failed to process video upgrade' });
      }
    });

    // Handle billing room join
    socket.on('billing:join-room', (data) => {
      try {
        const { consultationId } = data;
        console.log(`💰 User ${userId} joining billing room: ${consultationId}`);
        
        socket.join(`billing:${consultationId}`);
        
        socket.emit('billing:joined', {
          consultationId,
          message: 'Successfully joined billing room'
        });
        
        logger.info(`User ${userId} joined billing room: ${consultationId}`);
      } catch (error) {
        console.error('Error joining billing room:', error);
        socket.emit('error', { message: 'Failed to join billing room' });
      }
    });

    // Handle billing updates (called from billing controller)
    socket.on('billing:update-request', async (data) => {
      try {
        const { consultationId } = data;
        console.log(`💰 Billing update requested for consultation: ${consultationId}`);
        
        // This will be used by the billing controller to request real-time updates
        // The actual billing logic remains in the controller
        socket.emit('billing:update-acknowledged', {
          consultationId,
          timestamp: new Date()
        });
        
      } catch (error) {
        console.error('Error handling billing update request:', error);
      }
    });

    // Handle typing indicator
    socket.on('typing:start', (data) => {
      socket.to(`consultation:${data.consultationId}`).emit('typing:start', { userId });
    });

    socket.on('typing:stop', (data) => {
      socket.to(`consultation:${data.consultationId}`).emit('typing:stop', { userId });
    });

    // Handle provider status change
    socket.on('provider:statusChange', (data) => {
      const { consultationStatus } = data;
      
      // Broadcast status change to all connected clients
      socket.broadcast.emit('provider:statusChanged', {
        providerId: userId,
        consultationStatus,
        isOnline: consultationStatus !== 'offline'
      });
    });

    // ===== CHAT SYSTEM EVENTS =====
    
    // Join chat room
    socket.on('chat:join', (data) => {
      const { chatId, providerId, userId: targetUserId } = data;
      const roomName = `chat:${chatId}`;
      
      socket.join(roomName);
      console.log(`👥 User ${userId} joined chat room: ${roomName}`);
      
      // Notify other users in the room
      socket.to(roomName).emit('user:joinedChat', {
        userId,
        userName: socket.data.user?.fullName || socket.data.user?.name || 'User'
      });
    });

    // Handle chat message sending
    socket.on('chat:sendMessage', async (data) => {
      try {
        const { chatId, providerId, message } = data;
        const roomName = `chat:${chatId}`;
        
        // Create message object with proper sender info
        const messageData = {
          _id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          chatId,
          sender: userId,
          senderName: socket.data.user?.fullName || socket.data.user?.name || 'User',
          senderAvatar: socket.data.user?.profilePhoto || null,
          message,
          timestamp: new Date().toISOString(),
          status: 'sent'
        };

        console.log(`📨 Broadcasting message in room ${roomName}:`, messageData);

        // Broadcast to all users in the chat room (including sender for confirmation)
        io.to(roomName).emit('chat:message', messageData);
        
        // Also send to specific users if they're not in the room
        const providerSockets = onlineUsers.get(providerId);
        const userSockets = onlineUsers.get(userId);
        
        // Notify provider if they're online but not in chat room
        if (providerSockets && userId !== providerId) {
          providerSockets.forEach(socketId => {
            const providerSocket = io.sockets.sockets.get(socketId);
            if (providerSocket && !providerSocket.rooms.has(roomName)) {
              providerSocket.emit('chat:newMessage', messageData);
            }
          });
        }
        
        // Notify user if they have multiple sessions
        if (userSockets) {
          userSockets.forEach(socketId => {
            const userSocket = io.sockets.sockets.get(socketId);
            if (userSocket && userSocket.id !== socket.id && !userSocket.rooms.has(roomName)) {
              userSocket.emit('chat:newMessage', messageData);
            }
          });
        }

        console.log(`✅ Chat message sent in room ${roomName} by user ${userId}`);
        
      } catch (error) {
        console.error('Error handling chat message:', error);
        socket.emit('chat:error', { message: 'Failed to send message' });
      }
    });

    // Handle typing indicators for chat
    socket.on('chat:typing', (data) => {
      const { chatId, isTyping } = data;
      const roomName = `chat:${chatId}`;
      
      socket.to(roomName).emit('chat:typing', {
        userId,
        isTyping,
        userName: socket.data.user?.fullName || socket.data.user?.name || 'User'
      });
    });

    // Handle marking messages as read
    socket.on('chat:markAsRead', (data) => {
      const { messageId, chatId } = data;
      const roomName = `chat:${chatId}`;
      
      // Broadcast read status to other users in the chat
      socket.to(roomName).emit('chat:messageStatus', {
        messageId,
        status: 'read'
      });
      
      console.log(`Message ${messageId} marked as read by user ${userId}`);
    });

    // Join provider room for notifications
    socket.on('provider:join', (data) => {
      if (socket.data.user?.isServiceProvider) {
        const providerRoom = `provider:${userId}`;
        socket.join(providerRoom);
        console.log(`Provider ${userId} joined provider room: ${providerRoom}`);
      }
    });

    // Leave chat room
    socket.on('chat:leave', (data) => {
      const { chatId } = data;
      const roomName = `chat:${chatId}`;
      
      socket.leave(roomName);
      console.log(`User ${userId} left chat room: ${roomName}`);
      
      // Notify other participants that user left
      socket.to(roomName).emit('chat:userLeft', {
        userId,
        userName: socket.data.user?.fullName || socket.data.user?.name || 'User'
      });
    });

    // Mark messages as read
    socket.on('chat:markAsRead', (data) => {
      const { chatId, messageIds } = data;
      const roomName = `chat:${chatId}`;
      
      // Notify sender that messages were read
      socket.to(roomName).emit('chat:messagesRead', {
        messageIds,
        readBy: userId,
        readByName: socket.data.user?.fullName || socket.data.user?.name || 'User'
      });
    });

    // ===== END CHAT SYSTEM EVENTS =====

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

        // If no more sockets for this user, mark as offline (only for regular users, not guests)
        if (userSockets.length === 0) {
          onlineUsers.delete(userId);
          if (!socket.data.user?.isGuest) {
            User.findByIdAndUpdate(userId, { isOnline: false, lastActive: new Date() }).exec();
          }
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

