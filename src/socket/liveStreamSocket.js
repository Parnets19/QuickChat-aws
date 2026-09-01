
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
      let liveStream = await LiveStream.findById(liveStreamId);
      
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
      
      // Populate streamer and viewers user data
      liveStream = await LiveStream.findById(liveStreamId)
        .populate('streamer', 'fullName profilePhoto')
        .populate('viewers.user', 'fullName profilePhoto');
      
      // Calculate active viewers (those who haven't left, and exclude streamer).
      // NOTE: admin viewers are Admin-model docs, so populate('viewers.user') on a
      // ref:"User" field leaves viewer.user === null for them. Guard against null
      // to avoid "Cannot read properties of null (reading 'toString')".
      const streamerId = liveStream.streamer?._id
        ? liveStream.streamer._id.toString()
        : liveStream.streamer?.toString();
      const activeViewersCount = liveStream.viewers.filter(viewer => 
        !viewer.leftAt && viewer.user && viewer.user.toString() !== streamerId
      ).length;
      
      // Notify everyone in the room that a user joined (including the sender)
      io.to(`live-stream:${liveStreamId}`).emit('live-stream:viewer-joined', {
        userId,
        user: socket.data.user,
        viewerCount: activeViewersCount,
      });
      
      socket.emit('live-stream:joined', {
        liveStreamId,
        liveStream,
        viewerCount: activeViewersCount,
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
      
      let liveStream = await LiveStream.findById(liveStreamId);
      
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
      
      // Populate to get active viewers
      liveStream = await LiveStream.findById(liveStreamId)
        .populate('streamer', 'fullName profilePhoto')
        .populate('viewers.user', 'fullName profilePhoto');
      
      // Calculate active viewers (those who haven't left, and exclude streamer).
      // Guard against null viewer.user (admin viewers don't populate against User).
      const streamerId = liveStream.streamer?._id
        ? liveStream.streamer._id.toString()
        : liveStream.streamer?.toString();
      const activeViewersCount = liveStream.viewers.filter(viewer => 
        !viewer.leftAt && viewer.user && viewer.user.toString() !== streamerId
      ).length;
      
      // Notify everyone in the room (including the sender)
      io.to(`live-stream:${liveStreamId}`).emit('live-stream:viewer-left', {
        userId,
        viewerCount: activeViewersCount,
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

  // Forward WebRTC signaling events to specific users
  const handleWebRTCOffer = (socket, data) => {
    try {
      const { liveStreamId, offer, to } = data;
      if (!liveStreamId || !to) {
        console.log('⚠️ Missing liveStreamId or to in webrtc offer');
        return;
      }
      console.log(`📤 Forwarding WebRTC offer from ${socket.data.userId} to user:${to}`);
      socket.to(`user:${to}`).emit('webrtc:offer', {
        offer,
        liveStreamId,
        from: socket.data.userId,
      });
      console.log(`✅ WebRTC offer forwarded to user:${to}`);
    } catch (error) {
      console.error('Error forwarding webrtc offer for live stream:', error);
    }
  };

  const handleWebRTCAnswer = (socket, data) => {
    try {
      const { liveStreamId, answer, to } = data;
      if (!liveStreamId || !to) {
        console.log('⚠️ Missing liveStreamId or to in webrtc answer');
        return;
      }
      console.log(`📤 Forwarding WebRTC answer from ${socket.data.userId} to user:${to}`);
      socket.to(`user:${to}`).emit('webrtc:answer', {
        answer,
        liveStreamId,
        from: socket.data.userId,
      });
      console.log(`✅ WebRTC answer forwarded to user:${to}`);
    } catch (error) {
      console.error('Error forwarding webrtc answer for live stream:', error);
    }
  };

  const handleWebRTCIceCandidate = (socket, data) => {
    try {
      const { liveStreamId, candidate, to } = data;
      if (!liveStreamId || !to) {
        console.log('⚠️ Missing liveStreamId or to in webrtc ice candidate');
        return;
      }
      console.log(`🧊 Forwarding ICE candidate from ${socket.data.userId} to user:${to}`);
      socket.to(`user:${to}`).emit('webrtc:ice-candidate', {
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
      if (!liveStreamId) {
        console.log('⚠️ Missing liveStreamId in ready-to-receive');
        return;
      }
      console.log(`📢 User ${socket.data.userId} is ready to receive (role: ${role}), broadcasting to live-stream:${liveStreamId}`);
      // Send to everyone in the live stream room (for streamer to receive)
      socket.to(`live-stream:${liveStreamId}`).emit('webrtc:ready-to-receive', {
        from: socket.data.userId,
        liveStreamId,
        role,
        timestamp: new Date(),
      });
      console.log(`✅ Ready-to-receive broadcast to live-stream:${liveStreamId}`);
    } catch (error) {
      console.error('Error forwarding ready-to-receive for live stream:', error);
    }
  };
  
  const handleLike = async (socket, data) => {
    try {
      const { liveStreamId, emoji } = data;
      const userId = socket.data.userId;

      let liveStream = await LiveStream.findById(liveStreamId);
      
      if (!liveStream) {
        socket.emit('error', { message: 'Live stream not found' });
        return;
      }

      // Increment likes count
      liveStream.likes = (liveStream.likes || 0) + 1;
      await liveStream.save();

      // Emit to everyone in the room
      io.to(`live-stream:${liveStreamId}`).emit('live-stream:like', {
        userId,
        likeCount: liveStream.likes,
        emoji: emoji || '❤️',
      });
      
      console.log(`User ${userId} liked live stream ${liveStreamId} with emoji ${emoji}, new count: ${liveStream.likes}`);
    } catch (error) {
      console.error('Error handling live stream like:', error);
      socket.emit('error', { message: 'Failed to like live stream' });
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
    handleLike,
  };
};
