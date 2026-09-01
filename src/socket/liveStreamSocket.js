
const { LiveStream, User } = require('../models');

module.exports = (io) => {
  // Count the LIVE viewers actually connected to the stream's socket room,
  // excluding the streamer. Using live room membership (instead of the DB
  // viewers array) means the count self-corrects when someone closes the tab
  // or disconnects — socket.io removes them from the room automatically, so
  // stale "leftAt: null" records can no longer inflate the number. Distinct
  // userIds are counted so a viewer with multiple tabs still counts once.
  const getLiveViewerCount = (liveStreamId, streamerId) => {
    const room = io.sockets.adapter.rooms.get(`live-stream:${liveStreamId}`);
    if (!room) return 0;
    const uniqueUserIds = new Set();
    for (const socketId of room) {
      const s = io.sockets.sockets.get(socketId);
      const uid = s?.data?.userId;
      if (!uid) continue;
      if (streamerId && uid.toString() === streamerId.toString()) continue; // exclude streamer
      if (s?.data?.user?.isAdminAccount === true) continue; // exclude admin monitors
      uniqueUserIds.add(uid.toString());
    }
    return uniqueUserIds.size;
  };

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
      
      // Count live viewers from actual socket-room membership (excludes streamer,
      // self-corrects on disconnect). This replaces the old DB-array count that
      // over-counted stale viewers who left without calling /leave.
      const streamerId = liveStream.streamer?._id
        ? liveStream.streamer._id.toString()
        : liveStream.streamer?.toString();
      const activeViewersCount = getLiveViewerCount(liveStreamId, streamerId);
      
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
      
      // Count live viewers from actual socket-room membership. socket.leave()
      // above already removed this socket, so the count reflects the departure.
      const streamerId = liveStream.streamer?._id
        ? liveStream.streamer._id.toString()
        : liveStream.streamer?.toString();
      const activeViewersCount = getLiveViewerCount(liveStreamId, streamerId);
      
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

  // Called on socket "disconnecting" (fires while socket.rooms still lists the
  // rooms). When a viewer closes their tab without emitting live-stream:leave,
  // this updates the DB and broadcasts a fresh viewer count so the streamer's
  // number goes down instead of staying stale.
  const handleDisconnecting = async (socket) => {
    try {
      const userId = socket.data.userId;
      if (!userId) return;

      // Find any live-stream rooms this socket is currently in
      const liveRooms = [];
      for (const room of socket.rooms) {
        if (typeof room === 'string' && room.startsWith('live-stream:')) {
          liveRooms.push(room.slice('live-stream:'.length));
        }
      }
      if (liveRooms.length === 0) return;

      for (const liveStreamId of liveRooms) {
        try {
          const liveStream = await LiveStream.findById(liveStreamId);
          if (!liveStream) continue;

          // Mark this viewer as left (best-effort; final billing handled elsewhere)
          const viewerIndex = liveStream.viewers.findIndex(
            (v) => v.user && v.user.toString() === userId.toString()
          );
          if (viewerIndex !== -1 && !liveStream.viewers[viewerIndex].leftAt) {
            liveStream.viewers[viewerIndex].leftAt = new Date();
            await liveStream.save();
          }

          const streamerId = liveStream.streamer?.toString();
          // This socket hasn't been removed from the room yet (disconnecting),
          // so exclude it explicitly when counting.
          const room = io.sockets.adapter.rooms.get(`live-stream:${liveStreamId}`);
          const uniqueUserIds = new Set();
          if (room) {
            for (const socketId of room) {
              if (socketId === socket.id) continue; // exclude the leaving socket
              const s = io.sockets.sockets.get(socketId);
              const uid = s?.data?.userId;
              if (!uid) continue;
              if (streamerId && uid.toString() === streamerId.toString()) continue;
              if (s?.data?.user?.isAdminAccount === true) continue;
              uniqueUserIds.add(uid.toString());
            }
          }

          io.to(`live-stream:${liveStreamId}`).emit('live-stream:viewer-left', {
            userId,
            viewerCount: uniqueUserIds.size,
          });
        } catch (innerErr) {
          console.error('Error handling live-stream disconnect for', liveStreamId, innerErr.message);
        }
      }
    } catch (error) {
      console.error('Error in handleDisconnecting (live stream):', error);
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
    handleDisconnecting,
  };
};
