const { Server } = require('socket.io');

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
    this.userSockets = new Map(); // socketId -> { userId, consultationId }

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log('User connected:', socket.id);

      // Join consultation room
      socket.on('join-consultation', (data) => {
        const { consultationId, userId } = data;
        console.log(`User ${userId || 'unknown'} joining consultation ${consultationId}`);

        // Leave any previous rooms
        this.leaveAllRooms(socket);

        // Join new room
        socket.join(consultationId);
        
        // Track user in room
        if (!this.consultationRooms.has(consultationId)) {
          this.consultationRooms.set(consultationId, new Set());
        }
        this.consultationRooms.get(consultationId).add(socket.id);
        
        // Track socket info
        this.userSockets.set(socket.id, { userId, consultationId });

        // Notify others in the room
        socket.to(consultationId).emit('user-joined', {
          socketId: socket.id,
          userId: userId
        });

        console.log(`Room ${consultationId} now has ${this.consultationRooms.get(consultationId).size} users`);
      });

      // Handle WebRTC signaling
      socket.on('offer', (data) => {
        console.log('Relaying offer for consultation:', data.consultationId);
        socket.to(data.consultationId).emit('offer', {
          offer: data.offer,
          from: socket.id
        });
      });

      socket.on('answer', (data) => {
        console.log('Relaying answer for consultation:', data.consultationId);
        socket.to(data.consultationId).emit('answer', {
          answer: data.answer,
          from: socket.id
        });
      });

      socket.on('ice-candidate', (data) => {
        console.log('Relaying ICE candidate for consultation:', data.consultationId);
        socket.to(data.consultationId).emit('ice-candidate', {
          candidate: data.candidate,
          from: socket.id
        });
      });

      // Handle consultation end
      socket.on('end-consultation', (data) => {
        console.log('Ending consultation:', data.consultationId);
        socket.to(data.consultationId).emit('consultation-ended', {
          endedBy: socket.id
        });
        
        // Clean up room
        this.cleanupConsultation(data.consultationId);
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
        this.handleDisconnect(socket);
      });
    });
  }

  leaveAllRooms(socket) {
    const userInfo = this.userSockets.get(socket.id);
    if (userInfo && userInfo.consultationId) {
      const consultationId = userInfo.consultationId;
      
      // Leave socket room
      socket.leave(consultationId);
      
      // Remove from tracking
      if (this.consultationRooms.has(consultationId)) {
        this.consultationRooms.get(consultationId).delete(socket.id);
        
        // Notify others in room
        socket.to(consultationId).emit('user-left', {
          socketId: socket.id,
          userId: userInfo.userId
        });
        
        // Clean up empty room
        if (this.consultationRooms.get(consultationId).size === 0) {
          this.consultationRooms.delete(consultationId);
        }
      }
    }
  }

  handleDisconnect(socket) {
    this.leaveAllRooms(socket);
    this.userSockets.delete(socket.id);
  }

  cleanupConsultation(consultationId) {
    if (this.consultationRooms.has(consultationId)) {
      const socketIds = this.consultationRooms.get(consultationId);
      
      // Remove all sockets from tracking
      socketIds.forEach(socketId => {
        this.userSockets.delete(socketId);
      });
      
      // Remove room
      this.consultationRooms.delete(consultationId);
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