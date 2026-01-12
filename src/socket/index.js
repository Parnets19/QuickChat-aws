const jwt = require("jsonwebtoken");
const { User, Guest, Consultation } = require("../models");
const { logger } = require("../utils/logger");

const onlineUsers = new Map(); // userId -> socketIds[]
const callTimeouts = new Map(); // consultationId -> timeoutId
const offlineTimeouts = new Map(); // userId -> timeoutId (for debouncing offline status)

const initializeSocket = (io) => {
  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      console.log(
        "Socket authentication attempt from:",
        socket.handshake.address
      );
      const token = socket.handshake.auth.token;

      if (!token) {
        console.log("Socket authentication failed: No token provided");
        return next(new Error("Authentication error: No token provided"));
      }

      console.log("Socket token received, length:", token.length);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log("Socket token decoded successfully for user:", decoded.id);

      // Handle guest users
      if (decoded.isGuest) {
        // Fetch guest details from database
        const guest = await Guest.findById(decoded.id);
        if (!guest) {
          console.log(
            "Socket authentication failed: Guest not found for ID:",
            decoded.id
          );
          return next(new Error("Guest not found"));
        }

        console.log(
          "Socket authentication successful for guest user:",
          guest.name
        );
        socket.data.userId = decoded.id;
        socket.data.user = {
          _id: decoded.id,
          fullName: guest.name,
          mobile: guest.mobile,
          isGuest: true,
          isServiceProvider: false,
        };
        return next();
      }

      // Handle regular users
      const user = await User.findById(decoded.id);

      if (!user) {
        console.log(
          "Socket authentication failed: User not found for ID:",
          decoded.id
        );
        return next(new Error("User not found"));
      }

      console.log("Socket authentication successful for user:", user.fullName);
      socket.data.userId = user._id.toString();
      socket.data.user = user;
      next();
    } catch (error) {
      console.error("Socket authentication error:", error.message);
      next(new Error("Authentication error: " + error.message));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    const userName = socket.data.user?.fullName || "Unknown";
    console.log(
      `Socket connection established for user: ${userName} (${userId})`
    );
    logger.info(`User connected: ${userId}`);

    // Add user to online users
    if (onlineUsers.has(userId)) {
      onlineUsers.get(userId).push(socket.id);
    } else {
      onlineUsers.set(userId, [socket.id]);
    }

    // Clear any pending offline timeout for this user
    if (offlineTimeouts.has(userId)) {
      clearTimeout(offlineTimeouts.get(userId));
      offlineTimeouts.delete(userId);
      console.log(
        `🔄 Cleared offline timeout for user ${userId} (reconnected)`
      );
    }

    // Update user online status (only for regular users, not guests)
    if (!socket.data.user?.isGuest) {
      User.findByIdAndUpdate(userId, {
        isOnline: true,
        lastActive: new Date(),
      }).exec();
    }

    // Send online status to all connections
    socket.broadcast.emit("user:online", {
      userId,
      consultationStatus: socket.data.user?.consultationStatus || "available",
    });

    // Join user's personal room for global notifications
    socket.join(`user:${userId}`);
    console.log(`User ${userId} joined personal room: user:${userId}`);

    // Handle consultation join with duplicate prevention
    socket.on("consultation:join", async (data) => {
      try {
        const consultation = await Consultation.findById(data.consultationId);

        if (!consultation) {
          socket.emit("error", { message: "Consultation not found" });
          return;
        }

        // Check if user is part of consultation (handle guest users)
        const consultationUserId =
          typeof consultation.user === "string"
            ? consultation.user
            : consultation.user.toString();
        const consultationProviderId = consultation.provider.toString();

        if (
          consultationUserId !== userId &&
          consultationProviderId !== userId
        ) {
          socket.emit("error", { message: "Unauthorized" });
          return;
        }

        // Check if user is already in the room to prevent duplicates
        const room = io.sockets.adapter.rooms.get(
          `consultation:${data.consultationId}`
        );
        const isAlreadyInRoom = room && Array.from(room).includes(socket.id);

        if (isAlreadyInRoom) {
          console.log(
            `User ${userId} already in consultation room, skipping duplicate join`
          );
          // Still send confirmation but don't notify others
          const isProvider = consultationProviderId === userId;
          socket.emit("consultation:joined", {
            consultationId: data.consultationId,
            isProvider: isProvider,
            participantCount: room.size,
          });
          return;
        }

        socket.join(`consultation:${data.consultationId}`);

        // Get updated room info after joining
        const updatedRoom = io.sockets.adapter.rooms.get(
          `consultation:${data.consultationId}`
        );
        const participantCount = updatedRoom ? updatedRoom.size : 1;

        // Determine user role - handle provider-to-provider consultations
        let isProvider = consultationProviderId === userId;

        // For provider-to-provider consultations, use consultation-specific roles
        if (consultation.isProviderToProvider) {
          console.log(
            `🔍 SOCKET DEBUG - Provider-to-provider consultation detected`
          );

          // Check consultation-specific role from participantRoles
          if (consultation.participantRoles) {
            if (consultationUserId === userId) {
              // This is the booking provider (user field) - they are the client in this consultation
              isProvider =
                consultation.participantRoles.bookingProvider === "provider";
              console.log(
                `🔍 SOCKET DEBUG - Booking provider role: ${consultation.participantRoles.bookingProvider}`
              );
            } else if (consultationProviderId === userId) {
              // This is the booked provider (provider field) - they are the provider in this consultation
              isProvider =
                consultation.participantRoles.bookedProvider === "provider";
              console.log(
                `🔍 SOCKET DEBUG - Booked provider role: ${consultation.participantRoles.bookedProvider}`
              );
            }
          }

          console.log(
            `🔍 SOCKET DEBUG - Provider-to-provider role determination:`,
            {
              userId,
              consultationUserId,
              consultationProviderId,
              finalIsProvider: isProvider,
              bookingProviderRole:
                consultation.participantRoles?.bookingProvider,
              bookedProviderRole: consultation.participantRoles?.bookedProvider,
            }
          );
        }

        console.log(
          `✅ User joined consultation: ${userId} as ${
            isProvider ? "provider" : "client"
          } (${participantCount} participants)`
        );

        socket.emit("consultation:joined", {
          consultationId: data.consultationId,
          isProvider: isProvider,
          participantCount: participantCount,
          isProviderToProvider: consultation.isProviderToProvider || false,
        });

        // Only notify others if this is a new join and there are other participants
        if (participantCount > 1) {
          socket
            .to(`consultation:${data.consultationId}`)
            .emit("participant:joined", {
              userId: userId,
              isProvider: isProvider,
              participantCount: participantCount,
            });
        }

        logger.info(
          `User ${userId} joined consultation ${data.consultationId} as ${
            isProvider ? "provider" : "client"
          } (${participantCount} total participants)`
        );
      } catch (error) {
        console.error("Error in consultation join:", error);
        socket.emit("error", { message: "Failed to join consultation" });
      }
    });

    // Handle consultation start
    socket.on("consultation:start", async (data) => {
      try {
        const consultation = await Consultation.findById(data.consultationId);

        if (!consultation || consultation.provider.toString() !== userId) {
          socket.emit("error", { message: "Unauthorized" });
          return;
        }

        consultation.status = "ongoing";
        consultation.startTime = new Date();
        await consultation.save();

        // Mark provider as busy for all consultation types
        await User.findByIdAndUpdate(consultation.provider, {
          consultationStatus: "busy",
          isInCall: true,
          currentConsultationId: consultation._id,
        });

        io.to(`consultation:${data.consultationId}`).emit(
          "consultation:started",
          {
            consultationId: data.consultationId,
            startTime: consultation.startTime,
          }
        );

        logger.info(`Consultation started: ${data.consultationId}`);
      } catch (error) {
        socket.emit("error", { message: "Failed to start consultation" });
      }
    });

    // Handle incoming call notification (ring system)
    // NOTE: Ring notifications are now handled by real-time billing controller
    // This socket handler is disabled to prevent duplicate notifications
    socket.on("consultation:ring", async (data) => {
      console.log(
        "⚠️ DEPRECATED: consultation:ring event received - notifications now handled by real-time billing controller"
      );
      console.log("📋 Consultation ID:", data.consultationId);
      console.log(
        "💡 Ring notifications are sent automatically when consultation starts via real-time billing"
      );

      // This handler is intentionally disabled to prevent duplicate notifications
      // The real-time billing controller now handles all incoming call notifications
    });

    // Handle chat message
    socket.on("consultation:message", async (data) => {
      try {
        console.log("📨 BACKEND: Received message data:", data);
        console.log("📨 BACKEND: Message type:", data.type);
        console.log("📨 BACKEND: Has file:", !!data.file);
        if (data.file) {
          console.log("📨 BACKEND: File details:", data.file);
        }

        const consultation = await Consultation.findById(data.consultationId);

        if (!consultation) {
          console.log(
            "❌ BACKEND: Consultation not found:",
            data.consultationId
          );
          socket.emit("error", { message: "Consultation not found" });
          return;
        }

        // Check if user is part of consultation (handle guest users)
        const consultationUserId =
          typeof consultation.user === "string"
            ? consultation.user
            : consultation.user.toString();
        const consultationProviderId = consultation.provider.toString();

        if (
          consultationUserId !== userId &&
          consultationProviderId !== userId
        ) {
          console.log("❌ BACKEND: Unauthorized user:", userId);
          socket.emit("error", { message: "Unauthorized" });
          return;
        }

        // Get sender information for proper notifications
        let senderUser = socket.data.user; // Use already loaded user data
        let senderName = "User";
        let senderAvatar = null;

        if (socket.data.user?.isGuest) {
          // Handle guest users
          senderName =
            socket.data.user.fullName || socket.data.user.name || "Guest User";
        } else {
          // Handle regular users - use socket.data.user instead of querying again
          senderName = senderUser
            ? senderUser.fullName ||
              senderUser.name ||
              `${senderUser.firstName || ""} ${
                senderUser.lastName || ""
              }`.trim() ||
              "User"
            : "User";
          senderAvatar = senderUser?.profilePhoto || null;
        }

        // Create unique message ID to prevent duplicates
        // Note: Mongoose will auto-generate _id as ObjectId
        const messageData = {
          sender: userId,
          senderName: senderName,
          senderAvatar: senderAvatar,
          message: data.message,
          timestamp: new Date(),
          type: data.type || "text",
          file: data.file || null,
          status: "delivered",
          readBy: [], // Track who has read this message
        };

        console.log("📨 BACKEND: Saving message data:", messageData);

        consultation.messages.push(messageData);

        // Update last message timestamp for conversation sorting
        consultation.lastMessageAt = new Date();

        await consultation.save();

        // Get the saved message with auto-generated _id
        const savedMessage =
          consultation.messages[consultation.messages.length - 1];

        console.log(
          "📨 BACKEND: Broadcasting message to room:",
          `consultation:${data.consultationId}`
        );

        // FIXED: Only broadcast once to consultation room
        // Remove duplicate emissions that were causing 3x message display
        io.to(`consultation:${data.consultationId}`).emit(
          "consultation:message",
          savedMessage.toObject() // Use the saved message with proper _id
        );

        // Send targeted notifications to users not in the consultation room
        const otherUserId =
          consultationUserId === userId
            ? consultationProviderId
            : consultationUserId;

        // Update unread count for the other user
        const unreadCountUpdate = {
          consultationId: data.consultationId,
          unreadCount: 1,
          lastMessage: {
            message: data.message,
            timestamp: savedMessage.timestamp,
            senderName: senderName,
          },
        };

        // Send notification to other user's personal room
        io.to(`user:${otherUserId}`).emit(
          "chat:unreadUpdate",
          unreadCountUpdate
        );

        // Send push notification data
        const notificationData = {
          senderId: userId,
          senderName: senderName,
          senderAvatar: senderAvatar,
          receiverId: otherUserId,
          message: data.message,
          consultationId: data.consultationId,
          timestamp: savedMessage.timestamp.toISOString(),
          type: "consultation_message",
        };

        io.to(`user:${otherUserId}`).emit(
          "chat:notification",
          notificationData
        );

        logger.info(
          `Message sent in consultation ${data.consultationId} - Type: ${
            savedMessage.type
          }, Has file: ${!!savedMessage.file}`
        );
      } catch (error) {
        console.error("❌ BACKEND: Error handling message:", error);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // Handle message read status
    socket.on("consultation:markAsRead", async (data) => {
      try {
        const { consultationId, messageIds } = data;

        const consultation = await Consultation.findById(consultationId);
        if (!consultation) {
          socket.emit("error", { message: "Consultation not found" });
          return;
        }

        // Check if user is part of consultation
        const consultationUserId =
          typeof consultation.user === "string"
            ? consultation.user
            : consultation.user.toString();
        const consultationProviderId = consultation.provider.toString();

        if (
          consultationUserId !== userId &&
          consultationProviderId !== userId
        ) {
          socket.emit("error", { message: "Unauthorized" });
          return;
        }

        // Mark messages as read
        let updated = false;
        consultation.messages.forEach((msg) => {
          if (
            messageIds.includes(msg._id.toString()) ||
            messageIds.includes(msg._id)
          ) {
            if (!msg.readBy) msg.readBy = [];
            if (!msg.readBy.includes(userId)) {
              msg.readBy.push(userId);
              updated = true;
            }
          }
        });

        if (updated) {
          await consultation.save();

          // Broadcast read status to other participants
          socket
            .to(`consultation:${consultationId}`)
            .emit("consultation:messagesRead", {
              messageIds,
              readBy: userId,
              readByName:
                socket.data.user?.fullName || socket.data.user?.name || "User",
            });

          // Update unread count for the reader
          io.to(`user:${userId}`).emit("chat:unreadUpdate", {
            consultationId,
            unreadCount: 0, // Reset unread count
            markAsRead: true,
          });
        }

        console.log(`Messages marked as read by user ${userId}`);
      } catch (error) {
        console.error("Error marking messages as read:", error);
        socket.emit("error", { message: "Failed to mark messages as read" });
      }
    });

    // Handle consultation end - ENHANCED FOR BILATERAL TERMINATION
    socket.on("consultation:end", async (data) => {
      try {
        console.log(
          `🛑 BACKEND: User ${userId} is ending consultation ${data.consultationId}`
        );

        const consultation = await Consultation.findById(data.consultationId);

        if (!consultation) {
          socket.emit("error", { message: "Consultation not found" });
          return;
        }

        // Either party can end the consultation (handle guest users)
        const consultationUserId =
          typeof consultation.user === "string"
            ? consultation.user
            : consultation.user.toString();
        const consultationProviderId = consultation.provider.toString();

        if (
          consultationUserId !== userId &&
          consultationProviderId !== userId
        ) {
          socket.emit("error", { message: "Unauthorized" });
          return;
        }

        // Only update if consultation is ongoing (not pending, already completed, or auto-cancelled)
        // Don't override statuses like 'no_answer', 'cancelled', 'missed' that were set by system
        if (consultation.status === "ongoing") {
          consultation.status = "completed";
          consultation.endTime = new Date();

          // Calculate duration in minutes
          if (consultation.startTime) {
            const duration = Math.ceil(
              (consultation.endTime.getTime() -
                consultation.startTime.getTime()) /
                (1000 * 60)
            );
            consultation.duration = duration;
            consultation.totalAmount = duration * consultation.rate;
          }
        } else if (
          ["no_answer", "cancelled", "missed"].includes(consultation.status)
        ) {
          console.log(
            `⚠️ Not overriding consultation status '${consultation.status}' - keeping system-set status`
          );
          // Don't change the status, but still update provider availability
        }

        // Mark provider as no longer busy
        // Check if provider has any other ongoing consultations
        const ongoingConsultations = await Consultation.countDocuments({
          provider: consultation.provider,
          status: "ongoing",
          _id: { $ne: consultation._id }, // Exclude current consultation
        });

        const newStatus = ongoingConsultations > 0 ? "busy" : "available";

        await User.findByIdAndUpdate(consultation.provider, {
          consultationStatus: newStatus,
          isInCall: ongoingConsultations > 0,
          currentConsultationId:
            ongoingConsultations > 0
              ? consultation.currentConsultationId
              : null,
        });

        console.log(
          `📱 Provider ${consultation.provider} status updated to: ${newStatus} (${ongoingConsultations} ongoing consultations)`
        );

        await consultation.save();
        console.log(
          `✅ BACKEND: Consultation ${data.consultationId} status: ${consultation.status}`
        );

        // BILATERAL TERMINATION FIX: Notify ALL participants in BOTH room formats
        console.log(
          `🛑 BACKEND: Broadcasting consultation end to ALL room formats for bilateral termination`
        );

        const endEventData = {
          consultationId: data.consultationId,
          endTime: consultation.endTime,
          duration: consultation.duration,
          totalAmount: consultation.totalAmount,
          endedBy: userId,
          consultation: consultation, // Include full consultation data
        };

        // Send to mobile app format room
        io.to(`consultation:${data.consultationId}`).emit(
          "consultation:ended",
          endEventData
        );

        // Send to web app format room
        io.to(`billing:${data.consultationId}`).emit(
          "consultation:ended",
          endEventData
        );

        // Also send to individual user rooms to ensure delivery
        const otherUserId =
          consultationUserId === userId
            ? consultationProviderId
            : consultationUserId;

        io.to(`user:${otherUserId}`).emit("consultation:ended", endEventData);

        console.log(
          `✅ BACKEND: Bilateral termination events sent to all room formats and user rooms`
        );

        // Force disconnect all sockets in consultation rooms
        const consultationRoom = io.sockets.adapter.rooms.get(
          `consultation:${data.consultationId}`
        );
        const billingRoom = io.sockets.adapter.rooms.get(
          `billing:${data.consultationId}`
        );

        if (consultationRoom) {
          console.log(
            `🛑 BACKEND: Force disconnecting ${consultationRoom.size} clients from consultation room`
          );
          consultationRoom.forEach((socketId) => {
            const clientSocket = io.sockets.sockets.get(socketId);
            if (clientSocket) {
              clientSocket.leave(`consultation:${data.consultationId}`);
              console.log(
                `🛑 BACKEND: Removed socket ${socketId} from consultation room`
              );
            }
          });
        }

        if (billingRoom) {
          console.log(
            `🛑 BACKEND: Force disconnecting ${billingRoom.size} clients from billing room`
          );
          billingRoom.forEach((socketId) => {
            const clientSocket = io.sockets.sockets.get(socketId);
            if (clientSocket) {
              clientSocket.leave(`billing:${data.consultationId}`);
              console.log(
                `🛑 BACKEND: Removed socket ${socketId} from billing room`
              );
            }
          });
        }

        logger.info(
          `Consultation ended by user ${userId}: ${data.consultationId} - bilateral termination completed`
        );
      } catch (error) {
        console.error("❌ BACKEND: Error ending consultation:", error);
        socket.emit("error", { message: "Failed to end consultation" });
      }
    });

    // UNIFIED WebRTC OFFER HANDLER - Supports both mobile and web formats
    const handleWebRTCOffer = (data, callback) => {
      try {
        // Get room info to check if other party is connected
        const room = io.sockets.adapter.rooms.get(
          `consultation:${data.consultationId}`
        );
        const participantCount = room ? room.size : 0;
        const roomMembers = room ? Array.from(room) : [];

        console.log(
          `📞 WebRTC offer received from ${userId} for consultation ${data.consultationId}`
        );
        console.log(
          `📊 Room info: ${participantCount} participants, socket IDs: ${roomMembers.join(
            ", "
          )}`
        );

        // Log if this is an upgrade offer
        if (data.isUpgrade) {
          console.log(
            `📹 BACKEND: Video upgrade offer detected from ${userId}`
          );
        }

        if (participantCount < 2) {
          console.log(
            `⚠️ Cannot forward offer - only ${participantCount} participant(s) in room`
          );
          if (callback)
            callback({
              success: false,
              error: "No other participant connected",
            });
          return;
        }

        // Get list of socket IDs in room (excluding sender)
        const recipientSockets = roomMembers.filter((id) => id !== socket.id);
        console.log(
          `📤 Broadcasting offer to ${
            recipientSockets.length
          } recipient(s): ${recipientSockets.join(", ")}`
        );

        // CROSS-PLATFORM FIX: Send WebRTC offer to both room formats AND both event formats
        const offerData = {
          offer: data.offer,
          from: userId,
          consultationId: data.consultationId, // Include consultationId for verification
          isUpgrade: data.isUpgrade, // Forward the upgrade flag
        };

        // Send to mobile format (consultation room, webrtc: events)
        socket
          .to(`consultation:${data.consultationId}`)
          .emit("webrtc:offer", offerData);

        // Send to web format (billing room, plain events)
        socket.to(`billing:${data.consultationId}`).emit("offer", offerData);
        socket
          .to(`billing:${data.consultationId}`)
          .emit("webrtc:offer", offerData);

        // Also send to consultation room with web format for cross-compatibility
        socket
          .to(`consultation:${data.consultationId}`)
          .emit("offer", offerData);

        console.log(
          `✅ WebRTC offer forwarded to ALL room and event formats for maximum compatibility`
        );
        if (callback) callback({ success: true });
      } catch (error) {
        console.error("Error handling WebRTC offer:", error);
        if (callback) callback({ success: false, error: error.message });
      }
    };

    // Handle WebRTC signaling for audio/video calls - BOTH FORMATS
    socket.on("webrtc:offer", handleWebRTCOffer); // Mobile format
    socket.on("offer", handleWebRTCOffer); // Web format

    // UNIFIED WebRTC ANSWER HANDLER - Supports both mobile and web formats
    const handleWebRTCAnswer = (data, callback) => {
      try {
        const room = io.sockets.adapter.rooms.get(
          `consultation:${data.consultationId}`
        );
        const participantCount = room ? room.size : 0;
        const roomMembers = room ? Array.from(room) : [];
        const recipientSockets = roomMembers.filter((id) => id !== socket.id);

        console.log(
          `📞 WebRTC answer received from ${userId} for consultation ${data.consultationId}`
        );
        console.log(
          `📊 Room info: ${participantCount} participants, broadcasting to ${recipientSockets.length} recipient(s)`
        );

        // Log if this is an upgrade answer
        if (data.isUpgrade) {
          console.log(
            `📹 BACKEND: Video upgrade answer detected from ${userId}`
          );
        }

        // CROSS-PLATFORM FIX: Send WebRTC answer to both room formats AND both event formats
        const answerData = {
          answer: data.answer,
          from: userId,
          consultationId: data.consultationId, // Include consultationId for verification
          isUpgrade: data.isUpgrade, // Forward the upgrade flag
        };

        // Send to mobile format (consultation room, webrtc: events)
        socket
          .to(`consultation:${data.consultationId}`)
          .emit("webrtc:answer", answerData);

        // Send to web format (billing room, plain events)
        socket.to(`billing:${data.consultationId}`).emit("answer", answerData);
        socket
          .to(`billing:${data.consultationId}`)
          .emit("webrtc:answer", answerData);

        // Also send to consultation room with web format for cross-compatibility
        socket
          .to(`consultation:${data.consultationId}`)
          .emit("answer", answerData);

        console.log(
          `✅ WebRTC answer forwarded to ALL room and event formats for maximum compatibility`
        );
        if (callback) callback({ success: true });
      } catch (error) {
        console.error("Error handling WebRTC answer:", error);
        if (callback) callback({ success: false, error: error.message });
      }
    };

    socket.on("webrtc:answer", handleWebRTCAnswer); // Mobile format
    socket.on("answer", handleWebRTCAnswer); // Web format

    // UNIFIED WebRTC ICE CANDIDATE HANDLER - Supports both mobile and web formats
    const handleWebRTCIceCandidate = (data, callback) => {
      try {
        // CROSS-PLATFORM FIX: Send ICE candidates to both room formats AND both event formats
        const candidateData = {
          candidate: data.candidate,
          from: userId,
          consultationId: data.consultationId,
        };

        // Send to mobile format (consultation room, webrtc: events)
        socket
          .to(`consultation:${data.consultationId}`)
          .emit("webrtc:ice-candidate", candidateData);

        // Send to web format (billing room, plain events)
        socket
          .to(`billing:${data.consultationId}`)
          .emit("ice-candidate", candidateData);
        socket
          .to(`billing:${data.consultationId}`)
          .emit("webrtc:ice-candidate", candidateData);

        // Also send to consultation room with web format for cross-compatibility
        socket
          .to(`consultation:${data.consultationId}`)
          .emit("ice-candidate", candidateData);

        if (callback) callback({ success: true });
      } catch (error) {
        console.error("Error handling ICE candidate:", error);
        if (callback) callback({ success: false, error: error.message });
      }
    };

    socket.on("webrtc:ice-candidate", handleWebRTCIceCandidate); // Mobile format
    socket.on("ice-candidate", handleWebRTCIceCandidate); // Web format

    // Handle video upgrade notification
    socket.on("consultation:upgrade-to-video", (data) => {
      try {
        console.log(
          `📹 User ${userId} is upgrading consultation ${data.consultationId} to video`
        );

        // Broadcast upgrade notification to other participants
        socket
          .to(`consultation:${data.consultationId}`)
          .emit("consultation:upgrade-to-video", {
            from: userId,
            consultationId: data.consultationId,
          });

        logger.info(
          `Video upgrade initiated by user ${userId} in consultation ${data.consultationId}`
        );
      } catch (error) {
        console.error("Error handling video upgrade:", error);
        socket.emit("error", { message: "Failed to process video upgrade" });
      }
    });

    // Handle incoming call notification
    socket.on("consultation:incoming-call", (data) => {
      try {
        const { consultationId, callType, fromName } = data;
        console.log(
          `📞 User ${userId} sending incoming call notification for consultation ${consultationId}`
        );

        // Broadcast incoming call notification to other participants in the consultation room
        socket
          .to(`consultation:${consultationId}`)
          .emit("consultation:incoming-call", {
            consultationId,
            callType: callType || "video",
            from: userId,
            fromName: fromName || "Unknown",
          });

        console.log(
          `✅ Incoming call notification sent to consultation room: ${consultationId}`
        );
        logger.info(
          `Incoming call notification sent by user ${userId} for consultation ${consultationId}`
        );
      } catch (error) {
        console.error("Error handling incoming call notification:", error);
        socket.emit("error", {
          message: "Failed to send incoming call notification",
        });
      }
    });

    // ===== CALL NOTIFICATION EVENTS =====

    // Handle call request (mobile app to provider)
    socket.on("consultation:call-request", async (data) => {
      try {
        const { consultationId, callType, to, fromName, message } = data;

        console.log(`📞 Call request received from ${userId} to ${to}:`, {
          consultationId,
          callType,
          fromName,
        });

        // Find provider's sockets
        const providerSockets = onlineUsers.get(to);

        if (providerSockets && providerSockets.length > 0) {
          // Send call notification to all provider's sockets
          providerSockets.forEach((socketId) => {
            const providerSocket = io.sockets.sockets.get(socketId);
            if (providerSocket) {
              providerSocket.emit("consultation:call-request", {
                consultationId,
                callType,
                from: userId,
                fromName,
                message,
                timestamp: new Date().toISOString(),
              });
            }
          });

          console.log(`✅ Call notification sent to provider ${to}`);

          // CROSS-PLATFORM FIX: Also broadcast to both room types
          // This ensures calls work regardless of which room format is used

          // Send to regular consultation room (mobile app format)
          io.to(`consultation:${consultationId}`).emit(
            "consultation:call-request",
            {
              consultationId,
              callType,
              from: userId,
              fromName,
              message,
              timestamp: new Date().toISOString(),
            }
          );

          // Send to billing room (web app format)
          io.to(`billing:${consultationId}`).emit("consultation:call-request", {
            consultationId,
            callType,
            from: userId,
            fromName,
            message,
            timestamp: new Date().toISOString(),
          });

          console.log(`📡 Call notification broadcasted to both room formats`);

          // Set timeout for call (60 seconds)
          const timeoutId = setTimeout(async () => {
            try {
              // Update consultation status in database
              const Consultation = require("../models/Consultation.model");
              const consultation = await Consultation.findById(consultationId);

              if (consultation && consultation.status === "pending") {
                console.log(
                  `⏰ Auto-rejecting call ${consultationId} - provider didn't answer within 1 minute`
                );

                // Update consultation status to rejected due to timeout
                consultation.status = "rejected";
                consultation.endTime = new Date();
                consultation.endReason = "timeout_no_answer";
                consultation.duration = 0;
                consultation.totalAmount = 0;
                await consultation.save();

                console.log(
                  `✅ Consultation ${consultationId} status updated to 'rejected' due to timeout`
                );
              }
            } catch (dbError) {
              console.error(
                `❌ Error updating consultation status for timeout ${consultationId}:`,
                dbError
              );
            }

            // Send timeout to caller
            socket.emit("consultation:call-timeout", {
              consultationId,
              message: "Provider did not answer the call",
              status: "rejected",
              reason: "timeout_no_answer",
            });

            // Also broadcast timeout to both room formats
            io.to(`consultation:${consultationId}`).emit(
              "consultation:call-timeout",
              {
                consultationId,
                message: "Provider did not answer the call",
                status: "rejected",
                reason: "timeout_no_answer",
                timestamp: new Date().toISOString(),
              }
            );

            io.to(`billing:${consultationId}`).emit(
              "consultation:call-timeout",
              {
                consultationId,
                message: "Provider did not answer the call",
                status: "rejected",
                reason: "timeout_no_answer",
                timestamp: new Date().toISOString(),
              }
            );

            console.log(
              `⏰ Call timeout sent for consultation ${consultationId} - status set to rejected`
            );

            // Remove timeout from map
            callTimeouts.delete(consultationId);
          }, 60000);

          // Store timeout ID for this consultation
          callTimeouts.set(consultationId, timeoutId);
          console.log(`⏰ Call timeout set for consultation ${consultationId}`);
        } else {
          // Provider is offline
          socket.emit("consultation:call-failed", {
            consultationId,
            message: "Provider is currently offline",
          });
        }
      } catch (error) {
        console.error("Error handling call request:", error);
        socket.emit("consultation:call-failed", {
          message: "Failed to send call request",
        });
      }
    });

    // Handle call acceptance (provider accepts call)
    socket.on("consultation:call-accept", async (data) => {
      try {
        const { consultationId, from } = data;

        console.log(
          `📞 Call accepted by provider ${userId} for consultation ${consultationId}`
        );

        // Clear the call timeout since provider accepted
        const timeoutId = callTimeouts.get(consultationId);
        if (timeoutId) {
          clearTimeout(timeoutId);
          callTimeouts.delete(consultationId);
          console.log(
            `⏰ Call timeout cleared for consultation ${consultationId}`
          );
        }

        const acceptanceData = {
          consultationId,
          acceptedBy: userId,
          acceptedByName: socket.data.user?.fullName || "Provider",
          timestamp: new Date().toISOString(),
        };

        // Find caller's sockets and notify directly
        const callerSockets = onlineUsers.get(from);
        if (callerSockets && callerSockets.length > 0) {
          callerSockets.forEach((socketId) => {
            const callerSocket = io.sockets.sockets.get(socketId);
            if (callerSocket) {
              callerSocket.emit("consultation:call-accepted", acceptanceData);
            }
          });
          console.log(`✅ Call acceptance notification sent to caller ${from}`);
        }

        // CRITICAL FIX: Broadcast to both room formats for cross-platform compatibility
        io.to(`consultation:${consultationId}`).emit(
          "consultation:call-accepted",
          acceptanceData
        );
        io.to(`billing:${consultationId}`).emit(
          "consultation:call-accepted",
          acceptanceData
        );

        // Also send WebRTC-specific acceptance events
        io.to(`consultation:${consultationId}`).emit(
          "webrtc:call-accepted",
          acceptanceData
        );
        io.to(`billing:${consultationId}`).emit(
          "webrtc:call-accepted",
          acceptanceData
        );

        console.log(
          `📡 Call acceptance broadcasted to both room formats for cross-platform compatibility`
        );
      } catch (error) {
        console.error("Error handling call acceptance:", error);
      }
    });

    // Handle alternative call acceptance event format
    socket.on("consultation:call-accepted", async (data) => {
      // Delegate to the main handler
      socket.emit("consultation:call-accept", data);
    });

    // Handle WebRTC-specific call acceptance
    socket.on("webrtc:call-accepted", async (data) => {
      // Delegate to the main handler
      socket.emit("consultation:call-accept", data);
    });

    // Handle call rejection (provider rejects call)
    socket.on("consultation:call-reject", async (data) => {
      try {
        const { consultationId, from, reason } = data;

        console.log(
          `📞 Call rejected by provider ${userId} for consultation ${consultationId}`
        );

        // Clear the call timeout since provider rejected (no need to wait anymore)
        const timeoutId = callTimeouts.get(consultationId);
        if (timeoutId) {
          clearTimeout(timeoutId);
          callTimeouts.delete(consultationId);
          console.log(
            `⏰ Call timeout cleared for consultation ${consultationId} (rejected)`
          );
        }

        // Find caller's sockets
        const callerSockets = onlineUsers.get(from);

        if (callerSockets && callerSockets.length > 0) {
          // Notify caller that call was rejected
          callerSockets.forEach((socketId) => {
            const callerSocket = io.sockets.sockets.get(socketId);
            if (callerSocket) {
              callerSocket.emit("consultation:call-rejected", {
                consultationId,
                rejectedBy: userId,
                rejectedByName: socket.data.user?.fullName || "Provider",
                reason: reason || "Call declined",
              });
            }
          });

          console.log(`✅ Call rejection notification sent to caller ${from}`);
        }
      } catch (error) {
        console.error("Error handling call rejection:", error);
      }
    });

    // ===== END CALL NOTIFICATION EVENTS =====

    // Handle billing room join
    socket.on("billing:join-room", (data) => {
      try {
        const { consultationId } = data;
        console.log(
          `💰 User ${userId} joining billing room: ${consultationId}`
        );

        socket.join(`billing:${consultationId}`);

        socket.emit("billing:joined", {
          consultationId,
          message: "Successfully joined billing room",
        });

        logger.info(`User ${userId} joined billing room: ${consultationId}`);
      } catch (error) {
        console.error("Error joining billing room:", error);
        socket.emit("error", { message: "Failed to join billing room" });
      }
    });

    // Handle billing updates (called from billing controller)
    socket.on("billing:update-request", async (data) => {
      try {
        const { consultationId } = data;
        console.log(
          `💰 Billing update requested for consultation: ${consultationId}`
        );

        // This will be used by the billing controller to request real-time updates
        // The actual billing logic remains in the controller
        socket.emit("billing:update-acknowledged", {
          consultationId,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error("Error handling billing update request:", error);
      }
    });

    // Handle typing indicator
    socket.on("typing:start", (data) => {
      socket
        .to(`consultation:${data.consultationId}`)
        .emit("typing:start", { userId });
    });

    socket.on("typing:stop", (data) => {
      socket
        .to(`consultation:${data.consultationId}`)
        .emit("typing:stop", { userId });
    });

    // Handle provider status change
    socket.on("provider:statusChange", (data) => {
      const { consultationStatus } = data;

      // Broadcast status change to all connected clients
      socket.broadcast.emit("provider:statusChanged", {
        providerId: userId,
        consultationStatus,
        isOnline: consultationStatus !== "offline",
      });

      // Emit user status change for WhatsApp-like message status
      socket.broadcast.emit("user:statusChange", {
        userId,
        isOnline: consultationStatus === "available",
        consultationStatus,
      });
    });

    // ===== CHAT SYSTEM EVENTS =====

    // Join chat room
    socket.on("chat:join", (data) => {
      const { chatId, providerId, userId: targetUserId } = data;
      const roomName = `chat:${chatId}`;

      socket.join(roomName);
      console.log(`👥 User ${userId} joined chat room: ${roomName}`);

      // Notify other users in the room
      socket.to(roomName).emit("user:joinedChat", {
        userId,
        userName:
          socket.data.user?.fullName || socket.data.user?.name || "User",
      });
    });

    // Handle chat message sending
    socket.on("chat:sendMessage", async (data) => {
      try {
        const { chatId, providerId, message } = data;
        const roomName = `chat:${chatId}`;

        // Create message object with proper sender info
        const messageData = {
          _id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          chatId,
          sender: userId,
          senderName:
            socket.data.user?.fullName || socket.data.user?.name || "User",
          senderAvatar: socket.data.user?.profilePhoto || null,
          message,
          timestamp: new Date().toISOString(),
          status: "sent",
        };

        console.log(
          `📨 Broadcasting message in room ${roomName}:`,
          messageData
        );

        // Broadcast to all users in the chat room (including sender for confirmation)
        io.to(roomName).emit("chat:message", messageData);

        // Also send to specific users if they're not in the room
        const providerSockets = onlineUsers.get(providerId);
        const userSockets = onlineUsers.get(userId);

        // Notify provider if they're online but not in chat room
        if (providerSockets && userId !== providerId) {
          providerSockets.forEach((socketId) => {
            const providerSocket = io.sockets.sockets.get(socketId);
            if (providerSocket && !providerSocket.rooms.has(roomName)) {
              providerSocket.emit("chat:newMessage", messageData);
            }
          });
        }

        // Notify user if they have multiple sessions
        if (userSockets) {
          userSockets.forEach((socketId) => {
            const userSocket = io.sockets.sockets.get(socketId);
            if (
              userSocket &&
              userSocket.id !== socket.id &&
              !userSocket.rooms.has(roomName)
            ) {
              userSocket.emit("chat:newMessage", messageData);
            }
          });
        }

        console.log(
          `✅ Chat message sent in room ${roomName} by user ${userId}`
        );
      } catch (error) {
        console.error("Error handling chat message:", error);
        socket.emit("chat:error", { message: "Failed to send message" });
      }
    });

    // Handle typing indicators for chat
    socket.on("chat:typing", (data) => {
      const { chatId, isTyping } = data;
      const roomName = `chat:${chatId}`;

      socket.to(roomName).emit("chat:typing", {
        userId,
        isTyping,
        userName:
          socket.data.user?.fullName || socket.data.user?.name || "User",
      });
    });

    // Handle marking messages as read
    socket.on("chat:markAsRead", (data) => {
      const { messageId, chatId, messageIds } = data;
      const roomName = `chat:${chatId}`;

      if (messageIds) {
        // Multiple messages
        socket.to(roomName).emit("chat:messagesRead", {
          messageIds,
          readBy: userId,
          readByName:
            socket.data.user?.fullName || socket.data.user?.name || "User",
        });
      } else if (messageId) {
        // Single message
        socket.to(roomName).emit("chat:messageStatus", {
          messageId,
          status: "read",
        });
      }

      console.log(`Messages marked as read by user ${userId}`);
    });

    // Join provider room for notifications
    socket.on("provider:join", (data) => {
      if (socket.data.user?.isServiceProvider) {
        const providerRoom = `provider:${userId}`;
        socket.join(providerRoom);
        console.log(`Provider ${userId} joined provider room: ${providerRoom}`);
      }
    });

    // Leave chat room
    socket.on("chat:leave", (data) => {
      const { chatId } = data;
      const roomName = `chat:${chatId}`;

      socket.leave(roomName);
      console.log(`User ${userId} left chat room: ${roomName}`);

      // Notify other participants that user left
      socket.to(roomName).emit("chat:userLeft", {
        userId,
        userName:
          socket.data.user?.fullName || socket.data.user?.name || "User",
      });
    });

    // ===== END CHAT SYSTEM EVENTS =====

    // Handle disconnect
    socket.on("disconnect", () => {
      logger.info(`User disconnected: ${userId}`);

      // Remove socket from user's socket list
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        const index = userSockets.indexOf(socket.id);
        if (index > -1) {
          userSockets.splice(index, 1);
        }

        // If no more sockets for this user, set a debounced offline timeout
        if (userSockets.length === 0) {
          onlineUsers.delete(userId);

          // Set a 3-second delay before marking user as offline
          // This prevents rapid online/offline flashing due to brief disconnections
          const offlineTimeout = setTimeout(() => {
            console.log(`⏰ Marking user ${userId} as offline after timeout`);

            // Double-check user is still offline (not reconnected)
            if (!onlineUsers.has(userId)) {
              if (!socket.data.user?.isGuest) {
                User.findByIdAndUpdate(userId, {
                  isOnline: false,
                  lastActive: new Date(),
                }).exec();
              }

              // Emit offline status to all clients
              io.emit("user:offline", { userId });
              console.log(`📡 Emitted user:offline for user ${userId}`);
            }

            // Clean up timeout
            offlineTimeouts.delete(userId);
          }, 3000); // 3 second delay

          offlineTimeouts.set(userId, offlineTimeout);
          console.log(`⏱️ Set offline timeout for user ${userId} (3 seconds)`);
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
