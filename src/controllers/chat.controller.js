const { Chat, ChatMessage, User, Guest } = require("../models");
const { AppError } = require("../middlewares/errorHandler");

// @desc    Send a chat message
// @route   POST /api/chat/send
// @access  Private (User/Guest)
const sendMessage = async (req, res, next) => {
  try {
    const { chatId, providerId, message } = req.body;
    const senderId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest || false;

    if (!providerId || !message?.trim()) {
      return next(new AppError("Provider ID and message are required", 400));
    }

    // CRITICAL: Check if sender has blocked receiver (one-way check)
    // Sender could be User or Guest
    let sender = null;
    if (isGuest) {
      sender = await Guest.findById(senderId);
    } else {
      sender = await User.findById(senderId);
    }

    // Receiver could also be User or Guest - try both
    let receiver = await User.findById(providerId);
    let receiverIsGuest = false;
    
    if (!receiver) {
      // Try finding as guest
      receiver = await Guest.findById(providerId);
      receiverIsGuest = true;
      console.log('📨 CHAT: Receiver is a guest user:', providerId);
    }

    if (!receiver) {
      console.error('❌ CHAT: Receiver not found in User or Guest collections:', providerId);
      return next(new AppError("User not found", 404));
    }

    // Check if sender blocked receiver (only for regular users, guests don't have block feature)
    const senderBlockedReceiver = sender && !isGuest && sender.blockedUsers && sender.blockedUsers.some(
      (blocked) => blocked.userId.toString() === providerId
    );

    // Check if receiver blocked sender (only if receiver is regular user)
    const receiverBlockedSender = !receiverIsGuest && receiver.blockedUsers && receiver.blockedUsers.some(
      (blocked) => blocked.userId.toString() === senderId.toString()
    );

    if (senderBlockedReceiver) {
      return next(new AppError("You have blocked this user. Unblock to send messages.", 403));
    }

    if (receiverBlockedSender) {
      return next(new AppError("This user has blocked you. Cannot send messages.", 403));
    }

    // Find or create chat
    let chat = await Chat.findOne({
      $or: [
        { user: senderId, provider: providerId },
        { user: providerId, provider: senderId },
      ],
    });

    if (!chat) {
      // Create new chat
      chat = new Chat({
        user: senderId,
        provider: providerId,
        isGuestUser: isGuest,
        lastMessage: message.trim(),
        lastMessageTime: new Date(),
        status: "active",
      });
      await chat.save();
    } else {
      // Update existing chat
      chat.lastMessage = message.trim();
      chat.lastMessageTime = new Date();
      chat.status = "active";
      await chat.save();
    }

    // Get sender info first
    let senderInfo = { name: "Unknown User", avatar: null };
    console.log("🔔 SENDER INFO DEBUG - Getting sender details:", {
      senderId: senderId,
      isGuest: isGuest,
      senderType: isGuest ? "Guest" : "User",
    });

    try {
      if (isGuest) {
        const guest = await Guest.findById(senderId);
        if (guest) {
          senderInfo = {
            name: guest.name,
            _id: guest._id,
            avatar: guest.profilePhoto || null,
          };
          console.log("🔔 GUEST SENDER INFO:", senderInfo);
        } else {
          console.log("🔔 Guest not found for ID:", senderId);
        }
      } else {
        const user = await User.findById(senderId);
        if (user) {
          senderInfo = {
            name: user.fullName || user.name,
            _id: user._id,
            avatar: user.profilePhoto || null,
          };
          console.log("🔔 USER SENDER INFO:", senderInfo);
        } else {
          console.log("🔔 User not found for ID:", senderId);
        }
      }
    } catch (error) {
      console.error("Error populating sender info:", error);
    }
    
    // CRITICAL FIX: Ensure sender info is properly set
    if (!senderInfo._id) {
      senderInfo._id = senderId;
    }
    if (!senderInfo.name || senderInfo.name === "Unknown User") {
      senderInfo.name = isGuest ? "Guest User" : "User";
    }

    // Create message with sender info
    const chatMessage = new ChatMessage({
      chat: chat._id,
      sender: senderId,
      senderType: isGuest ? "Guest" : "User",
      senderName: senderInfo.name,
      senderAvatar: senderInfo.avatar,
      message: message.trim(),
      timestamp: new Date(),
      status: "sent",
    });

    await chatMessage.save();

    // Add sender info to the message object
    const messageWithSender = {
      ...chatMessage.toObject(),
      sender: {
        _id: senderInfo._id,
        name: chatMessage.senderName,
        avatar: chatMessage.senderAvatar,
      },
      senderName: chatMessage.senderName,
      senderAvatar: chatMessage.senderAvatar,
    };

    // Emit socket event for real-time updates
    const io = req.app.get("io");
    if (io) {
      // CRITICAL FIX: Use the correct room name format
      // Mobile app joins with chat:join which creates room `chat:${chatId}`
      // But we need to use the actual chat._id, not the chatId parameter
      const roomName = `chat:${chat._id}`;

      console.log(`📨 CHAT CONTROLLER: Emitting message to room: ${roomName}`, {
        chatId: chat._id,
        messageId: chatMessage._id,
        senderId: senderId,
        senderName: chatMessage.senderName,
        senderIsGuest: isGuest,
        roomName: roomName,
      });
      
      // CRITICAL DEBUG: Check who is in the room
      const roomSockets = io.sockets.adapter.rooms.get(roomName);
      console.log(`📨 CHAT CONTROLLER: Room ${roomName} has ${roomSockets ? roomSockets.size : 0} connected sockets`);
      if (roomSockets) {
        console.log(`📨 CHAT CONTROLLER: Socket IDs in room:`, Array.from(roomSockets));
      }

      // Emit to chat room for real-time message display
      // FIXED: Emit as 'consultation:message' to match mobile app listeners
      const messagePayload = {
        _id: chatMessage._id,
        sender: {
          _id: senderId.toString(), // Send as object with _id for proper comparison
          name: chatMessage.senderName,
          avatar: chatMessage.senderAvatar,
        },
        senderName: chatMessage.senderName,
        senderAvatar: chatMessage.senderAvatar,
        message: message.trim(),
        timestamp: chatMessage.timestamp,
        status: "sent", // Initial status is 'sent'
      };
      
      console.log(`📨 CHAT CONTROLLER: Message payload:`, messagePayload);
      
      io.to(roomName).emit("consultation:message", messagePayload);
      
      console.log(`✅ CHAT CONTROLLER: Message emitted to room ${roomName}`);
      
      // CRITICAL FIX: Immediate status progression when both users are in chat
      // Check if the receiver is in the chat room (online and viewing chat)
      const receiverRoom = io.sockets.adapter.rooms.get(roomName);
      const receiverInRoom = receiverRoom && receiverRoom.size > 1; // More than just sender
      
      if (receiverInRoom) {
        console.log(`📨 CHAT CONTROLLER: Receiver is in room, marking as delivered`);
        
        // Only mark as 'delivered' (double tick) — NOT 'read'
        // 'read' (blue tick) should only happen when client explicitly sends chat:markAsRead
        chatMessage.status = 'delivered';
        await chatMessage.save();
        
        setTimeout(() => {
          io.to(roomName).emit("consultation:messageStatus", {
            messageId: chatMessage._id,
            status: "delivered",
          });
          console.log(`✅ CHAT CONTROLLER: Message status updated to delivered (double tick)`);
        }, 100);
      } else {
        console.log(`📨 CHAT CONTROLLER: Receiver not in room, status remains 'sent' (single tick)`);
      }

      // ENHANCED DEBUG: Determine the correct receiver based on chat structure
      // In the chat model: user = client/guest, provider = service provider
      // The receiver should be the OTHER participant in the chat
      let receiverId;

      console.log("🔔 ENHANCED DEBUG - Chat structure analysis:", {
        chatId: chat._id,
        chatUser: chat.user,
        chatProvider: chat.provider,
        senderId: senderId,
        providerId: providerId,
        isGuestUser: chat.isGuestUser,
        senderEqualsUser: senderId.toString() === chat.user.toString(),
        senderEqualsProvider: senderId.toString() === chat.provider.toString(),
      });

      if (senderId.toString() === chat.user.toString()) {
        // Sender is the client/guest, receiver is the provider
        receiverId = chat.provider;
        console.log("🔔 CASE 1: Sender is USER/CLIENT, receiver is PROVIDER");
      } else if (senderId.toString() === chat.provider.toString()) {
        // Sender is the provider, receiver is the client/guest
        receiverId = chat.user;
        console.log("🔔 CASE 2: Sender is PROVIDER, receiver is USER/CLIENT");
      } else {
        // Enhanced fallback logic for edge cases
        console.log(
          "🔔 CASE 3: Using fallback logic - sender not found in chat participants"
        );
        // If sender is not in chat, assume they are the provider and receiver is the user
        receiverId = chat.user;
      }

      console.log("🔔 Enhanced notification logic:", {
        senderId,
        providerId,
        chatUser: chat.user,
        chatProvider: chat.provider,
        receiverId,
        senderIsUser: senderId.toString() === chat.user.toString(),
        senderIsProvider: senderId.toString() === chat.provider.toString(),
        shouldSendNotification:
          receiverId && receiverId.toString() !== senderId.toString(),
      });

      // Only send notification if receiver is different from sender
      if (receiverId && receiverId.toString() !== senderId.toString()) {
        // Send targeted notification to the receiver only
        console.log("🔔 EMITTING NOTIFICATION - Details:", {
          receiverId: receiverId,
          receiverRoom: `user:${receiverId}`,
          senderId: senderId,
          senderName: chatMessage.senderName,
          message: message.trim(),
          chatId: chat._id,
          timestamp: new Date().toISOString(),
        });

        // CRITICAL: Double-check that we're not sending to the sender
        if (receiverId.toString() === senderId.toString()) {
          console.error(
            "🚨 CRITICAL ERROR: Trying to send notification to sender! Aborting."
          );
          return;
        }

        // Send to receiver's personal room ONLY
        const receiverRoom = `user:${receiverId}`;
        console.log(`🔔 Emitting to room: ${receiverRoom}`);

        // Send to receiver's personal room
        io.to(receiverRoom).emit("chat:newMessage", {
          _id: chatMessage._id,
          senderId: senderId,
          senderName: chatMessage.senderName,
          senderAvatar: chatMessage.senderAvatar,
          message: message.trim(),
          timestamp: chatMessage.timestamp,
          chatId: chat._id,
          status: "sent",
        });

        // Also send direct notification for better reliability
        io.to(receiverRoom).emit("direct:notification", {
          senderId: senderId,
          senderName: chatMessage.senderName,
          senderAvatar: chatMessage.senderAvatar,
          targetUserId: receiverId,
          message: message.trim(),
          timestamp: chatMessage.timestamp,
          consultationId: chat._id,
        });

        console.log("🔔 Targeted notification sent to receiver:", receiverId);
        
        // 🔔 SEND FIREBASE PUSH NOTIFICATION
        // Convert receiverId to string to ensure compatibility
        const receiverIdString = receiverId.toString();
        console.log(`📱 Sending Firebase push notification to user ${receiverIdString}`);
        try {
          const notificationTemplates = require('../utils/notificationTemplates');
          
          // Determine receiver type
          let receiverType = 'user';
          const Guest = require('../models/Guest.model');
          const isReceiverGuest = await Guest.findById(receiverIdString);
          if (isReceiverGuest) {
            receiverType = 'guest';
            console.log(`👤 Receiver ${receiverIdString} is a GUEST`);
          } else {
            console.log(`👤 Receiver ${receiverIdString} is a REGULAR USER`);
          }
          
          console.log(`📤 Sending push notification to ${receiverType}:`, {
            userId: receiverIdString,
            title: `New message from ${chatMessage.senderName}`,
            message: message.trim().substring(0, 50),
            chatId: chat._id
          });
          
          // Send custom notification for chat message (push only, don't save to notifications DB)
          await notificationTemplates.custom(
            receiverIdString,
            receiverType,
            `New message from ${chatMessage.senderName}`,
            message.trim().length > 50 ? message.trim().substring(0, 50) + '...' : message.trim(),
            'consultation',
            {
              chatId: chat._id.toString(),
              consultationId: chat._id.toString(),
              senderId: senderId.toString(),
              senderName: chatMessage.senderName,
              messageType: 'text',
              action: 'new_message'
            },
            io,
            { saveToDatabase: false }
          );
          console.log(`✅ Firebase push notification sent to user ${receiverIdString}`);
        } catch (notifError) {
          console.error('❌ Failed to send Firebase push notification:', notifError);
          console.error('❌ Error details:', notifError.stack);
        }
      } else {
        console.log(
          "🔔 Skipping notification - sender and receiver are the same"
        );
      }
    }

    res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: {
        chatMessage: messageWithSender,
        chatId: chat._id,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get chat history with a provider
// @route   GET /api/chat/history/:providerId
// @access  Private (User/Guest)
const getChatHistory = async (req, res, next) => {
  try {
    const { providerId } = req.params;
    const userId = req.user.id || req.user._id;
    const { page = 1, limit = 50 } = req.query;

    // Find chat
    const chat = await Chat.findOne({
      $or: [
        { user: userId, provider: providerId },
        { user: providerId, provider: userId },
      ],
    });

    if (!chat) {
      return res.status(200).json({
        success: true,
        data: {
          messages: [],
          chat: null,
          pagination: {
            page: 1,
            limit: 50,
            total: 0,
            pages: 0,
          },
        },
      });
    }

    // Get messages with pagination - now with stored sender info
    const skip = (page - 1) * limit;
    const messages = await ChatMessage.find({ chat: chat._id })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Messages now have senderName and senderAvatar stored directly
    const populatedMessages = messages.map((message) => {
      const messageObj = message.toObject();

      // Use stored sender info if available, otherwise fallback to population
      if (messageObj.senderName && messageObj.senderAvatar !== undefined) {
        return {
          ...messageObj,
          sender: {
            _id: messageObj.sender,
            name: messageObj.senderName,
            avatar: messageObj.senderAvatar,
          },
        };
      }

      // Fallback for old messages without stored sender info
      return messageObj;
    });

    const total = await ChatMessage.countDocuments({ chat: chat._id });

    // Don't automatically mark messages as read when loading chat history
    // Messages should only be marked as read when user explicitly opens the chat
    // This will be handled by the markMessagesAsRead endpoint

    res.status(200).json({
      success: true,
      data: {
        messages: populatedMessages.reverse(), // Reverse to show oldest first
        chat,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get chat notifications for providers
// @route   GET /api/chat/notifications
// @access  Private (Provider only)
const getChatNotifications = async (req, res, next) => {
  try {
    const providerId = req.user.id || req.user._id;

    if (!req.user.isServiceProvider) {
      return next(
        new AppError("Only service providers can access notifications", 403)
      );
    }

    // Get recent chats where provider is the recipient
    const chats = await Chat.find({ provider: providerId })
      .sort({ lastMessageTime: -1 })
      .limit(20);

    const notifications = [];

    for (const chat of chats) {
      // Get unread message count
      const unreadCount = await ChatMessage.countDocuments({
        chat: chat._id,
        sender: { $ne: providerId },
        status: { $ne: "read" },
      });

      if (unreadCount > 0) {
        let userName = "Unknown User";
        let userAvatar = null;

        // Handle guest users vs regular users
        if (chat.isGuestUser) {
          try {
            const guest = await Guest.findById(chat.user);
            if (guest) {
              userName = guest.name || "Guest User";
            }
          } catch (error) {
            console.error("Error fetching guest user:", error);
          }
        } else {
          try {
            const user = await User.findById(chat.user);
            if (user) {
              userName = user.fullName || user.name || "User";
            }
          } catch (error) {
            console.error("Error fetching regular user:", error);
          }
        }

        notifications.push({
          id: chat._id,
          userId: chat.user,
          userName,
          userAvatar,
          message: chat.lastMessage,
          timestamp: chat.lastMessageTime,
          isRead: unreadCount === 0,
          chatId: chat._id,
          unreadCount,
          isGuestUser: chat.isGuestUser,
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        notifications,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark notification as read
// @route   PUT /api/chat/notifications/:notificationId/read
// @access  Private (Provider only)
const markNotificationAsRead = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    const providerId = req.user.id || req.user._id;

    if (!req.user.isServiceProvider) {
      return next(
        new AppError(
          "Only service providers can mark notifications as read",
          403
        )
      );
    }

    // Mark all messages in this chat as read
    await ChatMessage.updateMany(
      {
        chat: notificationId,
        sender: { $ne: providerId },
        status: { $ne: "read" },
      },
      { status: "read" }
    );

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get chat list for user
// @route   GET /api/chat/list
// @access  Private (User/Guest)
const getChatList = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest || false;

    console.log(
      `📋 getChatList called for user: ${userId}, isGuest: ${isGuest}`
    );

    const chats = await Chat.find({
      $or: [{ user: userId }, { provider: userId }],
    }).sort({ lastMessageTime: -1 });

    console.log(`📋 Found ${chats.length} chats for user ${userId}`);

    const chatList = await Promise.all(
      chats.map(async (chat) => {
        console.log(`🔍 Processing chat: ${chat._id}`);

        const isUserTheClient = chat.user.toString() === userId.toString();
        const otherUserId = isUserTheClient ? chat.provider : chat.user;

        console.log(`🔍 Chat details:`, {
          chatId: chat._id,
          user: chat.user,
          provider: chat.provider,
          isUserTheClient,
          otherUserId,
        });

        // For guests calling this API, they are always the client (user field)
        // So if they're the client, the other user is the provider (never a guest)
        // If they're not the client, then they are a provider and the client could be a guest
        const isOtherUserGuest = !isUserTheClient && chat.isGuestUser;

        let otherUserName = "Unknown User";
        let otherUserAvatar = null;

        try {
          if (isOtherUserGuest) {
            // Other user is a guest
            const guest = await Guest.findById(otherUserId);
            if (guest) {
              otherUserName = guest.name || "Guest User";
              otherUserAvatar = guest.profilePhoto || null;
            } else {
              // Guest not found (may have been deleted) — show friendly name
              otherUserName = "Guest User";
            }
          } else {
            // Other user is a regular user/provider
            const user = await User.findById(otherUserId);
            if (user) {
              otherUserName = user.fullName || user.name || "User";
              otherUserAvatar = user.profilePhoto || null;

              // Debug logging
              console.log(`🔍 Chat list user debug:`, {
                userId: otherUserId,
                userName: otherUserName,
                profilePhoto: user.profilePhoto,
                avatarSet: otherUserAvatar,
              });
            } else {
              // User not found in User collection — try Guest collection as fallback
              const guest = await Guest.findById(otherUserId);
              if (guest) {
                otherUserName = guest.name || "Guest User";
                otherUserAvatar = guest.profilePhoto || null;
              } else {
                otherUserName = "Deleted User";
              }
            }
          }
        } catch (error) {
          console.error("Error fetching other user:", error);
        }

        // Calculate unread message count for this chat
        // Count messages where the sender is NOT the current user AND status is not 'read'
        const unreadCount = await ChatMessage.countDocuments({
          chat: chat._id,
          sender: { $ne: userId },
          status: { $in: ["sent", "delivered"] }, // Only count sent/delivered as unread, not 'read'
        });

        console.log(`🔍 Unread count calculation for chat ${chat._id}:`, {
          chatId: chat._id,
          currentUserId: userId,
          unreadCount,
          query: {
            chat: chat._id,
            sender: { $ne: userId },
            status: { $in: ["sent", "delivered"] },
          },
        });

        console.log(`🔍 Final chat object before return:`, {
          chatId: chat._id,
          otherUserName,
          otherUserAvatar,
          isOtherUserGuest,
          unreadCount,
        });

        return {
          chatId: chat._id,
          otherUser: {
            id: otherUserId,
            name: otherUserName,
            avatar: otherUserAvatar,
            isGuest: isOtherUserGuest,
          },
          lastMessage: chat.lastMessage || "",
          lastMessageTime: chat.lastMessageTime || new Date(),
          status: chat.status || "active",
          unreadCount: unreadCount,
          hasUnreadMessages: unreadCount > 0,
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        chats: chatList,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create or get existing chat
// @route   POST /api/chat/create
// @access  Private (User/Guest)
const createOrGetChat = async (req, res, next) => {
  try {
    const { providerId } = req.body;
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest || false;

    if (!providerId) {
      return next(new AppError("Provider ID is required", 400));
    }

    // Find existing chat
    let chat = await Chat.findOne({
      $or: [
        { user: userId, provider: providerId },
        { user: providerId, provider: userId },
      ],
    });

    if (!chat) {
      // Create new chat
      chat = new Chat({
        user: userId,
        provider: providerId,
        isGuestUser: isGuest,
        status: "active",
      });
      await chat.save();
    }

    // Populate user and provider info
    await chat.populate("user", "name fullName");
    await chat.populate("provider", "name fullName");

    res.status(200).json({
      success: true,
      data: {
        chat,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark messages as read
// @route   POST /api/chat/mark-read
// @access  Private (User/Guest)
const markMessagesAsRead = async (req, res, next) => {
  try {
    const { consultationId, messageIds } = req.body;
    const userId = req.user.id || req.user._id;

    if (!consultationId && !messageIds) {
      return next(
        new AppError("Consultation ID or message IDs are required", 400)
      );
    }

    let updateQuery = {};

    if (messageIds && messageIds.length > 0) {
      // Mark specific messages as read
      updateQuery = {
        _id: { $in: messageIds },
        sender: { $ne: userId },
        status: { $ne: "read" },
      };
    } else if (consultationId) {
      // For new chat system, consultationId is actually the chatId
      // Try to find chat by chatId first, then fall back to consultation lookup
      let chat = await Chat.findOne({ chatId: consultationId });

      if (!chat) {
        // Fall back to finding by _id for backward compatibility
        chat = await Chat.findById(consultationId);
      }

      if (!chat) {
        // If no chat found, try to mark messages directly by chatId
        updateQuery = {
          chatId: consultationId,
          sender: { $ne: userId },
          status: { $ne: "read" },
        };
      } else {
        updateQuery = {
          chat: chat._id,
          sender: { $ne: userId },
          status: { $ne: "read" },
        };
      }
    }

    const result = await ChatMessage.updateMany(updateQuery, {
      status: "read",
      readAt: new Date(),
    });

    // Emit socket event for real-time status updates
    const io = req.app.get("io");
    if (io && result.modifiedCount > 0) {
      // Emit message read status updates
      if (messageIds) {
        messageIds.forEach((messageId) => {
          io.emit("chat:messageStatus", {
            messageId,
            status: "read",
            readBy: userId,
          });
        });
      }

      // ENHANCED: Delete chat notifications from Notification collection
      // so they don't show in the notifications screen anymore
      try {
        const Notification = require('../models/Notification.model');
        await Notification.deleteMany({
          user: userId,
          type: 'consultation',
          'data.action': 'new_message',
          'data.chatId': consultationId,
        });
        // Also try with consultationId in data
        await Notification.deleteMany({
          user: userId,
          type: 'consultation',
          'data.action': 'new_message',
          'data.consultationId': consultationId,
        });
        console.log('🗑️ Chat notifications auto-removed for user:', userId, 'chat:', consultationId);
      } catch (notifErr) {
        console.error('⚠️ Failed to auto-remove chat notifications:', notifErr.message);
      }

      // ENHANCED: Clear notifications for the user who read the messages
      console.log(
        "🔔 Clearing notifications for user who read messages:",
        userId
      );

      // Send notification clear event to the user who read the messages
      // Use multiple room patterns to ensure delivery
      const userRooms = [
        `user:${userId}`,
        `provider:${userId}`,
        `client:${userId}`,
      ];

      userRooms.forEach((room) => {
        io.to(room).emit("chat:notificationsClear", {
          consultationId: consultationId,
          chatId: consultationId,
          clearedBy: userId,
          messageCount: result.modifiedCount,
        });

        // Also emit a general notification update to refresh notification counts
        io.to(room).emit("chat:unreadUpdate", {
          consultationId: consultationId,
          chatId: consultationId,
          unreadCount: 0,
          markAsRead: true,
        });
      });

      // Also emit to all connected sockets for this user (fallback)
      io.emit("chat:globalNotificationClear", {
        userId: userId,
        consultationId: consultationId,
        chatId: consultationId,
        clearedBy: userId,
        messageCount: result.modifiedCount,
      });

      console.log(
        "🔔 Enhanced notification clear events sent for",
        result.modifiedCount,
        "messages to multiple room patterns"
      );
    }

    res.status(200).json({
      success: true,
      message: "Messages marked as read",
      data: {
        modifiedCount: result.modifiedCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Send a file (image/PDF) in chat
// @route   POST /api/chat/send-file
// @access  Private (User/Guest)
const sendFileMessage = async (req, res, next) => {
  try {
    const { providerId } = req.body;
    const senderId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest || false;

    if (!providerId) return next(new AppError("Provider ID is required", 400));
    if (!req.file) return next(new AppError("No file uploaded", 400));

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const isPdf = ext === 'pdf';
    const fileType = isPdf ? 'file' : 'image';
    const fileUrl = `/uploads/${req.file.filename}`;

    // Find or create chat
    let chat = await Chat.findOne({
      $or: [
        { user: senderId, provider: providerId },
        { user: providerId, provider: senderId },
      ],
    });

    if (!chat) {
      chat = new Chat({
        user: senderId,
        provider: providerId,
        isGuestUser: isGuest,
        lastMessage: isPdf ? '📄 PDF' : '🖼️ Image',
        lastMessageTime: new Date(),
        status: 'active',
      });
      await chat.save();
    } else {
      chat.lastMessage = isPdf ? '📄 PDF' : '🖼️ Image';
      chat.lastMessageTime = new Date();
      await chat.save();
    }

    // Get sender info
    let senderName = 'User';
    let senderAvatar = null;
    try {
      if (isGuest) {
        const guest = await Guest.findById(senderId);
        if (guest) { senderName = guest.name; senderAvatar = guest.profilePhoto || null; }
      } else {
        const user = await User.findById(senderId);
        if (user) { senderName = user.fullName || user.name; senderAvatar = user.profilePhoto || null; }
      }
    } catch (e) { /* ignore */ }

    const chatMessage = new ChatMessage({
      chat: chat._id,
      sender: senderId,
      senderType: isGuest ? 'Guest' : 'User',
      senderName,
      senderAvatar,
      message: isPdf ? '📄 PDF Document' : '🖼️ Image',
      messageType: fileType,
      attachments: [{
        type: fileType,
        url: fileUrl,
        filename: req.file.originalname,
        size: req.file.size,
      }],
      timestamp: new Date(),
      status: 'sent',
    });

    await chatMessage.save();

    const payload = {
      _id: chatMessage._id,
      sender: { _id: senderId.toString(), name: senderName, avatar: senderAvatar },
      senderName,
      senderAvatar,
      message: chatMessage.message,
      messageType: fileType,
      attachments: chatMessage.attachments,
      timestamp: chatMessage.timestamp,
      status: 'sent',
    };

    // Emit via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${chat._id}`).emit('consultation:message', payload);
    }

    res.status(201).json({ success: true, data: { chatMessage: payload, chatId: chat._id } });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendMessage,
  sendFileMessage,
  getChatHistory,
  getChatNotifications,
  markNotificationAsRead,
  getChatList,
  createOrGetChat,
  markMessagesAsRead,
};
