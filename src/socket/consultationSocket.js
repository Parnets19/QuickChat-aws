const { Server } = require('socket.io');
const Consultation = require('../models/Consultation'); // Import the model to check host

class ConsultationSocket {
  constructor(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      }
    });

    this.consultationRooms = new Map(); // consultationId -> Set of socketIds
    this.consultationParticipants = new Map(); // consultationId -> Map of userId -> { socketId, joinedAt }
    this.userSockets = new Map(); // socketId -> { userId, consultationId }
    this.userIdToSocketId = new Map(); // userId -> socketId
    this.consultationHosts = new Map(); // consultationId -> hostUserId (the one who started the call)

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log('User connected:', socket.id);

      // Helper function to send full participants list to everyone in room (with details)
      const sendFullParticipantsList = (consultationId) => {
        if (this.consultationParticipants.has(consultationId)) {
          const participantsMap = this.consultationParticipants.get(consultationId);
          const participantsList = Array.from(participantsMap.entries()).map(([userId, info]) => ({
            userId,
            userName: info.userName || null,
            joinedAt: info.joinedAt,
            isHost: this.consultationHosts.get(consultationId) === userId
          }));
          this.io.to(consultationId).emit('participants-list', {
            participants: participantsList,
            hostUserId: this.consultationHosts.get(consultationId)
          });
        }
      };

      // Helper function to handle joining a consultation room
      const handleJoinRoom = async (data) => {
        const consultationId = data.consultationId || data.chatId;
        const userId = data.userId || data.providerId;
        
        if (!consultationId) {
          console.warn('No consultation/chat ID provided');
          return;
        }

        console.log(`User ${userId || 'unknown'} joining consultation ${consultationId}`);

        // Leave any previous rooms
        this.leaveAllRooms(socket);

        // Get list of existing participants in this room before adding new user
        const existingParticipantIds = [];
        if (this.consultationParticipants.has(consultationId)) {
          existingParticipantIds.push(...this.consultationParticipants.get(consultationId).keys());
        } else {
          // If no participants yet, check the consultation in DB to set host
          try {
            const consultation = await Consultation.findById(consultationId);
            if (consultation) {
              // Find host from participants array
              const hostParticipant = consultation.participants.find(p => p.role === 'host');
              if (hostParticipant) {
                this.consultationHosts.set(consultationId, String(hostParticipant.userId));
              }
            }
          } catch (error) {
            console.error('Error fetching consultation to find host:', error);
          }
        }

        // Join new room
        socket.join(consultationId);
        
        // Track user in room
        if (!this.consultationRooms.has(consultationId)) {
          this.consultationRooms.set(consultationId, new Set());
        }
        this.consultationRooms.get(consultationId).add(socket.id);
        
        // Track participants
        if (!this.consultationParticipants.has(consultationId)) {
          this.consultationParticipants.set(consultationId, new Map());
        }
        const joinedAt = new Date();
        const userName = data.userName || null;
        if (userId) {
          this.consultationParticipants.get(consultationId).set(userId, {
            socketId: socket.id,
            joinedAt: joinedAt,
            userName: userName,
          });
        }
        
        // Track socket info
        this.userSockets.set(socket.id, { userId, consultationId });
        if (userId) {
          this.userIdToSocketId.set(userId, socket.id);
        }

        // Send existing participants to the new user
        const existingParticipants = [];
        if (this.consultationParticipants.has(consultationId)) {
          const existingMap = this.consultationParticipants.get(consultationId);
          for (const [id, info] of existingMap.entries()) {
            if (id !== userId) {
              existingParticipants.push({
                userId: id,
                userName: info.userName || null,
                joinedAt: info.joinedAt,
                isHost: this.consultationHosts.get(consultationId) === id
              });
            }
          }
        }
        socket.emit('participants-list', {
          participants: existingParticipants,
          hostUserId: this.consultationHosts.get(consultationId)
        });

        // Send full participants list to everyone
        sendFullParticipantsList(consultationId);

        console.log(`Room ${consultationId} now has ${this.consultationRooms.get(consultationId).size} users`);
      };

      // Join consultation room (WebRTC version)
      socket.on('join-consultation', (data) => handleJoinRoom(data));
      
      // Join consultation room (consultation:join version)
      socket.on('consultation:join', (data) => handleJoinRoom(data));
      
      // Join chat room (chat:join version)
      socket.on('chat:join', (data) => handleJoinRoom(data));

      // Handle WebRTC signaling (both old and new event names)
      const relaySignalingEvent = (eventName, data) => {
        console.log(`Relaying ${eventName} for consultation:`, data.consultationId);
        
        if (data.to) {
          // Targeted signaling: send directly to specific user
          const targetSocketId = this.userIdToSocketId.get(data.to);
          if (targetSocketId) {
            console.log(`Sending ${eventName} directly to user ${data.to} (socket: ${targetSocketId})`);
            this.io.to(targetSocketId).emit(eventName, {
              ...data,
              from: data.from || socket.id
            });
          } else {
            console.warn(`Target user ${data.to} not found, falling back to room broadcast`);
            socket.to(data.consultationId).emit(eventName, {
              ...data,
              from: socket.id
            });
          }
        } else {
          // Original behavior: broadcast to room
          socket.to(data.consultationId).emit(eventName, {
            ...data,
            from: socket.id
          });
        }
      };

      // Old event names for backward compatibility
      socket.on('offer', (data) => relaySignalingEvent('offer', data));
      socket.on('answer', (data) => relaySignalingEvent('answer', data));
      socket.on('ice-candidate', (data) => relaySignalingEvent('ice-candidate', data));

      // New event names with targeted signaling support
      socket.on('webrtc:offer', (data) => relaySignalingEvent('webrtc:offer', data));
      socket.on('webrtc:answer', (data) => relaySignalingEvent('webrtc:answer', data));
      socket.on('webrtc:ice-candidate', (data) => relaySignalingEvent('webrtc:ice-candidate', data));
      socket.on('webrtc:process-offer-request', (data) => relaySignalingEvent('webrtc:process-offer-request', data));
      socket.on('webrtc:ready-to-receive', (data) => relaySignalingEvent('webrtc:ready-to-receive', data));
      socket.on('webrtc:create-offer-request', (data) => relaySignalingEvent('webrtc:create-offer-request', data));
      socket.on('webrtc:request-offer-resend', (data) => relaySignalingEvent('webrtc:request-offer-resend', data));
      socket.on('consultation:call-accepted', (data) => relaySignalingEvent('consultation:call-accepted', data));
      socket.on('webrtc:call-accepted', (data) => relaySignalingEvent('webrtc:call-accepted', data));
      socket.on('consultation:call-accept', (data) => relaySignalingEvent('consultation:call-accept', data));

      // Handle participant leaving (not ending the whole call)
      socket.on('consultation:participant-left', (data) => {
        const consultationId = data.consultationId;
        const userInfo = this.userSockets.get(socket.id);
        const userId = userInfo?.userId || data.userId;
        
        console.log(`Participant ${userId} leaving consultation ${consultationId} (not ending call)`);
        
        // Remove the participant from tracking
        if (this.consultationParticipants.has(consultationId)) {
          if (userId) {
            this.consultationParticipants.get(consultationId).delete(userId);
          }
        }
        
        // Notify everyone that this participant left
        this.io.to(consultationId).emit('participant-left', {
          userId: userId
        });
        
        // Send updated participants list
        sendFullParticipantsList(consultationId);
        
        // Check if we need to end the call (only 0 or 1 participant left)
        if (this.consultationParticipants.has(consultationId)) {
          const remainingParticipants = this.consultationParticipants.get(consultationId).size;
          if (remainingParticipants <= 1) {
            console.log(`Only ${remainingParticipants} participants left in ${consultationId}, ending call`);
            this.io.to(consultationId).emit('consultation-ended', {
              endedBy: userId,
              reason: 'not_enough_participants'
            });
            this.cleanupConsultation(consultationId);
          }
        }
        
        // Remove this user from the room
        this.leaveAllRooms(socket);
      });

      // Handle consultation end (from host or normal end)
      socket.on('consultation:end', (data) => {
        const consultationId = data.consultationId;
        const userInfo = this.userSockets.get(socket.id);
        const userId = userInfo?.userId;
        
        console.log(`Ending consultation ${consultationId} request from user ${userId}`);
        
        // Check if this user is the host
        const hostUserId = this.consultationHosts.get(consultationId);
        
        if (hostUserId === userId) {
          // Host is ending: end for everyone
          console.log('Host is ending the call, ending for everyone');
          this.io.to(consultationId).emit('consultation-ended', {
            endedBy: userId,
            endedByName: data.endedByName,
            reason: 'host_ended'
          });
          this.cleanupConsultation(consultationId);
        } else {
          // Not host: check number of participants
          const participantsCount = this.consultationParticipants.has(consultationId) 
            ? this.consultationParticipants.get(consultationId).size 
            : 0;
            
          if (participantsCount <= 2) {
            // Only 2 participants, so ending the call for everyone
            console.log('Only 2 participants, ending call for everyone');
            this.io.to(consultationId).emit('consultation-ended', {
              endedBy: userId,
              endedByName: data.endedByName,
              reason: 'last_participant_left'
            });
            this.cleanupConsultation(consultationId);
          } else {
            // More than 2 participants: just this user leaves
            console.log('More than 2 participants, just this user leaves');
            socket.emit('consultation-ended', {
              endedBy: userId,
              endedByName: data.endedByName,
              reason: 'user_left'
            });
            // Emit participant-left to others
            socket.to(consultationId).emit('participant-left', {
              userId: userId
            });
            // Remove from tracking
            if (this.consultationParticipants.has(consultationId)) {
              if (userId) {
                this.consultationParticipants.get(consultationId).delete(userId);
              }
            }
            sendFullParticipantsList(consultationId);
            this.leaveAllRooms(socket);
          }
        }
      });

      // Handle chat messages
      socket.on('chat-message', (data) => {
        console.log('Relaying chat message for consultation:', data.consultationId);
        socket.to(data.consultationId).emit('chat-message', {
          message: data.message,
          from: socket.id,
          timestamp: new Date().toISOString()
        });
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const userInfo = this.userSockets.get(socket.id);
        if (userInfo && userInfo.consultationId) {
          const consultationId = userInfo.consultationId;
          const userId = userInfo.userId;
          const hostUserId = this.consultationHosts.get(consultationId);
          
          if (hostUserId === userId) {
            // Host disconnected: end call for everyone
            console.log('Host disconnected, ending call for everyone');
            this.io.to(consultationId).emit('consultation-ended', {
              endedBy: userId,
              reason: 'host_disconnected'
            });
            this.cleanupConsultation(consultationId);
          } else {
            // Regular participant disconnected: check remaining count
            this.handleDisconnect(socket);
            // Check if we need to end call
            if (this.consultationParticipants.has(consultationId)) {
              const remaining = this.consultationParticipants.get(consultationId).size;
              if (remaining <= 1) {
                this.io.to(consultationId).emit('consultation-ended', {
                  reason: 'not_enough_participants'
                });
                this.cleanupConsultation(consultationId);
              }
            }
          }
        }
      });
    });
  }

  leaveAllRooms(socket) {
    const userInfo = this.userSockets.get(socket.id);
    if (userInfo && userInfo.consultationId) {
      const consultationId = userInfo.consultationId;
      const userId = userInfo.userId;
      
      // Leave socket room
      socket.leave(consultationId);
      
      // Remove from tracking
      if (this.consultationRooms.has(consultationId)) {
        this.consultationRooms.get(consultationId).delete(socket.id);
      }
      
      // Remove from participants map
      if (this.consultationParticipants.has(consultationId)) {
        if (userId) {
          this.consultationParticipants.get(consultationId).delete(userId);
        }
        // Clean up empty room
        if (this.consultationParticipants.get(consultationId).size === 0) {
          this.consultationParticipants.delete(consultationId);
          this.consultationHosts.delete(consultationId);
        } else {
          // Send updated participants list to others
          const sendFullParticipantsList = (consultationId) => {
            if (this.consultationParticipants.has(consultationId)) {
              const participantsMap = this.consultationParticipants.get(consultationId);
              const participantsList = Array.from(participantsMap.entries()).map(([userId, info]) => ({
                userId,
                joinedAt: info.joinedAt,
                isHost: this.consultationHosts.get(consultationId) === userId
              }));
              this.io.to(consultationId).emit('participants-list', {
                participants: participantsList,
                hostUserId: this.consultationHosts.get(consultationId)
              });
            }
          };
          sendFullParticipantsList(consultationId);
        }
      }
      
      // Notify others in room
      socket.to(consultationId).emit('user-left', {
        socketId: socket.id,
        userId: userId
      });

      // Clean up userId to socketId mapping
      if (userId && this.userIdToSocketId.get(userId) === socket.id) {
        this.userIdToSocketId.delete(userId);
      }
    }
  }

  handleDisconnect(socket) {
    const userInfo = this.userSockets.get(socket.id);
    this.leaveAllRooms(socket);
    this.userSockets.delete(socket.id);
    
    // Clean up userId to socketId mapping
    if (userInfo && userInfo.userId && this.userIdToSocketId.get(userInfo.userId) === socket.id) {
      this.userIdToSocketId.delete(userInfo.userId);
    }
  }

  cleanupConsultation(consultationId) {
    if (this.consultationRooms.has(consultationId)) {
      const socketIds = this.consultationRooms.get(consultationId);
      
      // Remove all sockets from tracking
      socketIds.forEach(socketId => {
        const userInfo = this.userSockets.get(socketId);
        this.userSockets.delete(socketId);
        
        // Clean up userId to socketId mapping
        if (userInfo && userInfo.userId && this.userIdToSocketId.get(userInfo.userId) === socketId) {
          this.userIdToSocketId.delete(userInfo.userId);
        }
      });
      
      // Remove room and host tracking
      this.consultationRooms.delete(consultationId);
      this.consultationParticipants.delete(consultationId);
      this.consultationHosts.delete(consultationId);
    }
  }

  // Get active consultations
  getActiveConsultations() {
    const active = {};
    this.consultationRooms.forEach((sockets, consultationId) => {
      active[consultationId] = sockets.size;
    });
    return active;
  }
}

module.exports = ConsultationSocket;