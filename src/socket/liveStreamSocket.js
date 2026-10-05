
const { LiveStream, User } = require('../models');

module.exports = (io) => {
  // Live stream socket handlers
  const joinLiveStreamRoom = async (socket, data) => {
    try {
      const { liveStreamId } = data;
      const userId = socket.data.userId;
      
      socket.join(`live-stream:${liveStreamId}`);
      console.log(`User ${userId} joined live stream room ${liveStreamId}`);

      // Join the room
      
      // Update the live stream viewers
      const liveStream = await LiveStream.findById(liveStreamId);
      
      if (!liveStream) {
        socket.emit('error', { message: 'Live stream not found' });
        return;
      }
      
      // Check if user is already in the viewers list
      const existingViewerIndex = liveStream.viewers.findIndex(viewer => viewer.user.toString() === userId.toString());
      
      if (existingViewerIndex === -1) {
        // Add the user as a new viewer
        liveStream.viewers.push({
          user: userId,
          joinedAt: new Date(),
        });
      } else {
        // If the user was a viewer who left, rejoin them
        liveStream.viewers[existingViewerIndex].leftAt = null;
      }
      
      await liveStream.save();
      
      // Notify everyone in the room that a user joined
      socket.to(`live-stream:${liveStreamId}`).emit('live-stream:viewer-joined', {
        userId,
        user: socket.data.user,
      });
      
      socket.emit('live-stream:joined', {
        liveStreamId,
        liveStream,
      });

    } catch (error) {
      console.error('Error in joinLiveStreamRoom:', error);
      socket.emit('error', { message: 'Failed to join live stream' });
    }
  };
  
  const leaveLiveStreamRoom = async (socket, data) => {
    try {
      const { liveStreamId } = data;
      const userId = socket.data.userId;
      
      socket.leave(`live-stream:${liveStreamId}`);
      
      const liveStream = await LiveStream.findById(liveStreamId);
      
      if (!liveStream) {
        socket.emit('error', { message: 'Live stream not found' });
        return;
      }

      const viewerIndex = liveStream.viewers.findIndex(viewer => viewer.user.toString() === userId.toString());

      if (viewerIndex !== -1) {
        // Mark the viewer as left
        liveStream.viewers[viewerIndex].leftAt = new Date();
        await liveStream.save();
      }
      
      // Notify everyone in the room
      socket.to(`live-stream:${liveStreamId}`).emit('live-stream:viewer-left', {
        userId,
      });
      
      socket.emit('live-stream:left', {
        liveStreamId,
      });
      
      console.log(`User ${userId} left live stream room ${liveStreamId}`);
    } catch (error) {
      console.error('Error leaving live stream:', error);
    }
  };
  
  const sendLiveStreamMessage = async (socket, data) => {
    try {
      const { liveStreamId, message } = data;
      const userId = socket.data.userId;
      
      socket.to(`live-stream:${liveStreamId}`).emit('live-stream:chat-message', {
        userId,
        user: socket.data.user,
        message,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Error sending live stream message:', error);
    }
  };

  // Forward WebRTC signaling events within live-stream rooms
  const handleWebRTCOffer = (socket, data) => {
    try {
      const { liveStreamId, offer } = data;
      if (!liveStreamId) return;
      socket.to(`live-stream:${liveStreamId}`).emit('webrtc:offer', {
        offer,
        liveStreamId,
        from: socket.data.userId,
      });
    } catch (error) {
      console.error('Error forwarding webrtc offer for live stream:', error);
    }
  };

  const handleWebRTCAnswer = (socket, data) => {
    try {
      const { liveStreamId, answer } = data;
      if (!liveStreamId) return;
      socket.to(`live-stream:${liveStreamId}`).emit('webrtc:answer', {
        answer,
        liveStreamId,
        from: socket.data.userId,
      });
    } catch (error) {
      console.error('Error forwarding webrtc answer for live stream:', error);
    }
  };

  const handleWebRTCIceCandidate = (socket, data) => {
    try {
      const { liveStreamId, candidate } = data;
      if (!liveStreamId) return;
      socket.to(`live-stream:${liveStreamId}`).emit('webrtc:ice-candidate', {
        candidate,
        liveStreamId,
        from: socket.data.userId,
      });
    } catch (error) {
      console.error('Error forwarding webrtc ice candidate for live stream:', error);
    }
  };

  const handleReadyToReceive = (socket, data) => {
    try {
      const { liveStreamId, role } = data;
      if (!liveStreamId) return;
      socket.to(`live-stream:${liveStreamId}`).emit('webrtc:ready-to-receive', {
        from: socket.data.userId,
        liveStreamId,
        role,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Error forwarding ready-to-receive for live stream:', error);
    }
  };
  
  return {
    joinLiveStreamRoom,
    leaveLiveStreamRoom,
    sendLiveStreamMessage,
    handleWebRTCOffer,
    handleWebRTCAnswer,
    handleWebRTCIceCandidate,
    handleReadyToReceive,
  };
};
