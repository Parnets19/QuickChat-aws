const { Chat, ChatMessage, User, Guest } = require('../models');
const { AppError } = require('../middlewares/errorHandler');

// @desc    Send a chat message
// @route   POST /api/chat/send
// @access  Private (User/Guest)
const sendMessage = async (req, res, next) => {
  try {
    const { chatId, providerId, message } = req.body;
    const senderId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest || false;

    if (!providerId || !message?.trim()) {
      return next(new AppError('Provider ID and message are required', 400));
    }

    // Find or create chat
    let chat = await Chat.findOne({
      $or: [
        { user: senderId, provider: providerId },
        { user: providerId, provider: senderId }
      ]
    });

    if (!chat) {
      // Create new chat
      chat = new Chat({
        user: senderId,
        provider: providerId,
        isGuestUser: isGuest,
        lastMessage: message.trim(),
        lastMessageTime: new Date(),
        status: 'active'
      });
      await chat.save();
    } else {
      // Update existing chat
      chat.lastMessage = message.trim();
      chat.lastMessageTime = new Date();
      chat.status = 'active';
      await chat.save();
    }

    // Create message
    const chatMessage = new ChatMessage({
      chat: chat._id,
      sender: senderId,
      senderType: isGuest ? 'Guest' : 'User',
      message: message.trim(),
      timestamp: new Date(),
      status: 'sent'
    });

    await chatMessage.save();

    // Manually populate sender info based on user type
    let senderInfo = { name: 'Unknown User' };
    try {
      if (isGuest) {
        const guest = await Guest.findById(senderId);
        if (guest) {
          senderInfo = {
            name: guest.name,
            _id: guest._id
          };
        }
      } else {
        const user = await User.findById(senderId);
        if (user) {
          senderInfo = {
            name: user.fullName || user.name,
            _id: user._id
          };
        }
      }
    } catch (error) {
      console.error('Error populating sender info:', error);
    }

    // Add sender info to the message object
    const messageWithSender = {
      ...chatMessage.toObject(),
      sender: senderInfo
    };

    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      const roomName = `chat:${chatId || chat._id}`;
      
      io.to(roomName).emit('chat:message', {
        _id: chatMessage._id,
        sender: senderId, // Send as string for proper comparison
        senderName: senderInfo.name,
        message: message.trim(),
        timestamp: chatMessage.timestamp,
        status: 'sent'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: {
        chatMessage: messageWithSender,
        chatId: chat._id
      }
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
        { user: providerId, provider: userId }
      ]
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
            pages: 0
          }
        }
      });
    }

    // Get messages with pagination
    const skip = (page - 1) * limit;
    const messages = await ChatMessage.find({ chat: chat._id })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Manually populate sender information based on user type
    const populatedMessages = await Promise.all(messages.map(async (message) => {
      let senderInfo = { name: 'Unknown User' };
      
      try {
        // First try to find as regular user
        const user = await User.findById(message.sender);
        if (user) {
          senderInfo = {
            name: user.fullName || user.name,
            _id: user._id
          };
        } else {
          // If not found as regular user, try as guest
          const guest = await Guest.findById(message.sender);
          if (guest) {
            senderInfo = {
              name: guest.name,
              _id: guest._id
            };
          }
        }
      } catch (error) {
        console.error('Error populating sender:', error);
      }

      return {
        ...message.toObject(),
        sender: senderInfo
      };
    }));

    const total = await ChatMessage.countDocuments({ chat: chat._id });

    // Mark messages as read if user is the recipient
    await ChatMessage.updateMany(
      { 
        chat: chat._id, 
        sender: { $ne: userId },
        status: { $ne: 'read' }
      },
      { status: 'read' }
    );

    res.status(200).json({
      success: true,
      data: {
        messages: populatedMessages.reverse(), // Reverse to show oldest first
        chat,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
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
      return next(new AppError('Only service providers can access notifications', 403));
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
        status: { $ne: 'read' }
      });

      if (unreadCount > 0 || chat.lastMessageTime > new Date(Date.now() - 24 * 60 * 60 * 1000)) {
        let userName = 'Unknown User';
        let userAvatar = null;

        // Handle guest users vs regular users
        if (chat.isGuestUser) {
          try {
            const guest = await Guest.findById(chat.user);
            if (guest) {
              userName = guest.name || 'Guest User';
            }
          } catch (error) {
            console.error('Error fetching guest user:', error);
          }
        } else {
          try {
            const user = await User.findById(chat.user);
            if (user) {
              userName = user.fullName || user.name || 'User';
            }
          } catch (error) {
            console.error('Error fetching regular user:', error);
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
          isGuestUser: chat.isGuestUser
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        notifications
      }
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
      return next(new AppError('Only service providers can mark notifications as read', 403));
    }

    // Mark all messages in this chat as read
    await ChatMessage.updateMany(
      { 
        chat: notificationId,
        sender: { $ne: providerId },
        status: { $ne: 'read' }
      },
      { status: 'read' }
    );

    res.status(200).json({
      success: true,
      message: 'Notification marked as read'
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

    const chats = await Chat.find({
      $or: [
        { user: userId },
        { provider: userId }
      ]
    })
    .sort({ lastMessageTime: -1 });

    const chatList = await Promise.all(chats.map(async (chat) => {
      const isUserTheClient = chat.user.toString() === userId.toString();
      const otherUserId = isUserTheClient ? chat.provider : chat.user;
      
      // For guests calling this API, they are always the client (user field)
      // So if they're the client, the other user is the provider (never a guest)
      // If they're not the client, then they are a provider and the client could be a guest
      const isOtherUserGuest = !isUserTheClient && chat.isGuestUser;
      
      let otherUserName = 'Unknown User';
      
      try {
        if (isOtherUserGuest) {
          // Other user is a guest
          const guest = await Guest.findById(otherUserId);
          if (guest) {
            otherUserName = guest.name || 'Guest User';
          }
        } else {
          // Other user is a regular user/provider
          const user = await User.findById(otherUserId);
          if (user) {
            otherUserName = user.fullName || user.name || 'User';
          }
        }
      } catch (error) {
        console.error('Error fetching other user:', error);
      }
      
      return {
        chatId: chat._id,
        otherUser: {
          id: otherUserId,
          name: otherUserName,
          avatar: null, // Add avatar logic if needed
          isGuest: isOtherUserGuest
        },
        lastMessage: chat.lastMessage || '',
        lastMessageTime: chat.lastMessageTime || new Date(),
        status: chat.status || 'active'
      };
    }));

    res.status(200).json({
      success: true,
      data: {
        chats: chatList
      }
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
      return next(new AppError('Provider ID is required', 400));
    }

    // Find existing chat
    let chat = await Chat.findOne({
      $or: [
        { user: userId, provider: providerId },
        { user: providerId, provider: userId }
      ]
    });

    if (!chat) {
      // Create new chat
      chat = new Chat({
        user: userId,
        provider: providerId,
        isGuestUser: isGuest,
        status: 'active'
      });
      await chat.save();
    }

    // Populate user and provider info
    await chat.populate('user', 'name fullName');
    await chat.populate('provider', 'name fullName');

    res.status(200).json({
      success: true,
      data: {
        chat
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendMessage,
  getChatHistory,
  getChatNotifications,
  markNotificationAsRead,
  getChatList,
  createOrGetChat
};