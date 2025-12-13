const { Consultation, User, Transaction, Notification } = require('../models');
const { AppError } = require('../middlewares/errorHandler');

// @desc    Create consultation booking
// @route   POST /api/consultations
// @access  Private
const createConsultation = async (req, res, next) => {
  try {
    const { providerId, type, paymentCompleted } = req.body;

    if (!providerId || !type) {
      return next(new AppError('Provider ID and consultation type are required', 400));
    }

    const provider = await User.findById(providerId);
    
    if (!provider || !provider.isServiceProvider) {
      return next(new AppError('Provider not found', 404));
    }

    // Check if consultation mode is enabled
    if (!provider.consultationModes?.[type]) {
      return next(new AppError(`${type} consultation is not available for this provider`, 400));
    }

    // Get rate based on provider's rate structure
    let rate = 0;
    
    if (provider.rates) {
      const defaultChargeType = provider.rates.defaultChargeType || 'per-minute';
      
      if (type === 'chat') {
        rate = provider.rates.chat || 0;
      } else if (defaultChargeType === 'per-minute' && provider.rates.perMinute) {
        rate = provider.rates.perMinute[type] || provider.rates[type] || 0;
      } else if (defaultChargeType === 'per-hour' && provider.rates.perHour) {
        rate = provider.rates.perHour[type] || 0;
      } else {
        // Fallback to legacy rate structure
        rate = provider.rates[type] || 0;
      }
    }

    // Get user info (no wallet balance check for initial request)
    const user = await User.findById(req.user?._id);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Determine initial status based on payment
    let initialStatus = 'pending';
    let notificationTitle = 'New Consultation Request';
    let notificationMessage = `New ${type} consultation request from ${user.fullName}`;
    let responseMessage = 'Consultation request sent successfully';

    // If payment is completed (for audio/video), keep status as pending until provider accepts
    // The provider still needs to accept/start the consultation even after payment
    if (paymentCompleted && (type === 'audio' || type === 'video')) {
      // Keep as pending - provider still needs to accept
      initialStatus = 'pending';
      notificationTitle = 'New Paid Consultation Request';
      notificationMessage = `${user.fullName} has paid for a ${type} consultation. Accept to start the session.`;
      responseMessage = 'Payment completed. Consultation request sent to provider.';
    }

    // Create consultation
    const consultation = await Consultation.create({
      user: req.user?._id,
      provider: providerId,
      type,
      rate,
      status: initialStatus,
      startTime: null, // Start time will be set when provider accepts/starts the consultation
    });

    // Create notification for provider
    await Notification.create({
      user: providerId,
      title: notificationTitle,
      message: notificationMessage,
      type: 'consultation',
      data: { consultationId: consultation._id },
    });

    res.status(201).json({
      success: true,
      message: responseMessage,
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get consultation by ID
// @route   GET /api/consultations/:id
// @access  Private
const getConsultation = async (req, res, next) => {
  try {
    const consultation = await Consultation.findById(req.params.id)
      .populate('user', 'fullName profilePhoto')
      .populate('provider', 'fullName profilePhoto rates');

    if (!consultation) {
      return next(new AppError('Consultation not found', 404));
    }

    // Check if user is part of consultation
    if (
      consultation.user.toString() !== req.user?._id.toString() &&
      consultation.provider.toString() !== req.user?._id.toString()
    ) {
      return next(new AppError('Not authorized', 403));
    }

    res.status(200).json({
      success: true,
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get user's consultations
// @route   GET /api/consultations
// @access  Private
const getMyConsultations = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, role } = req.query;

    let query;
    
    // Filter by role if specified
    if (role === 'provider') {
      query = { provider: req.user?._id };
    } else if (role === 'client') {
      query = { user: req.user?._id };
    } else {
      // Default: return all consultations where user is either client or provider
      query = {
        $or: [{ user: req.user?._id }, { provider: req.user?._id }],
      };
    }

    if (status) {
      query.status = status;
    }

    const consultations = await Consultation.find(query)
      .populate('user', 'fullName profilePhoto')
      .populate('provider', 'fullName profilePhoto')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Consultation.countDocuments(query);

    // Debug logging
    console.log(`Consultation query for user ${req.user?._id} with role ${role}:`, query);
    console.log(`Found ${consultations.length} consultations`);
    consultations.forEach(consultation => {
      console.log(`Consultation ${consultation._id}: user=${consultation.user?._id}, provider=${consultation.provider?._id}`);
    });

    res.status(200).json({
      success: true,
      data: consultations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get consultation history
// @route   GET /api/consultations/history
// @access  Private
const getConsultationHistory = async (req, res, next) => {
  try {
    const consultations = await Consultation.find({
      $or: [{ user: req.user?._id }, { provider: req.user?._id }],
      status: 'completed',
    })
      .populate('user', 'fullName profilePhoto')
      .populate('provider', 'fullName profilePhoto')
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({
      success: true,
      data: consultations,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Start consultation
// @route   PUT /api/consultations/:id/start
// @access  Private
const startConsultation = async (req, res, next) => {
  try {
    const consultation = await Consultation.findById(req.params.id);

    if (!consultation) {
      return next(new AppError('Consultation not found', 404));
    }

    // Only provider can start consultation
    if (consultation.provider.toString() !== req.user?._id.toString()) {
      return next(new AppError('Not authorized', 403));
    }

    consultation.status = 'ongoing';
    consultation.startTime = new Date();
    await consultation.save();

    res.status(200).json({
      success: true,
      message: 'Consultation started',
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    End consultation
// @route   PUT /api/consultations/:id/end
// @access  Private
const endConsultation = async (req, res, next) => {
  try {
    const consultation = await Consultation.findById(req.params.id);

    if (!consultation) {
      return next(new AppError('Consultation not found', 404));
    }

    // Either party can end consultation
    if (
      consultation.user.toString() !== req.user?._id.toString() &&
      consultation.provider.toString() !== req.user?._id.toString()
    ) {
      return next(new AppError('Not authorized', 403));
    }

    // Only allow ending consultations that are ongoing
    if (consultation.status !== 'ongoing') {
      return next(new AppError('Can only end ongoing consultations', 400));
    }

    consultation.status = 'completed';
    consultation.endTime = new Date();

    // Calculate duration and amount
    if (consultation.startTime) {
      const duration = Math.ceil(
        (consultation.endTime.getTime() - consultation.startTime.getTime()) / (1000 * 60)
      );
      consultation.duration = duration;
      consultation.totalAmount = duration * consultation.rate;

      // Transfer money to provider
      const user = await User.findById(consultation.user);
      const provider = await User.findById(consultation.provider);

      if (user && provider) {
        user.wallet -= consultation.totalAmount;
        provider.earnings += consultation.totalAmount;

        await user.save();
        await provider.save();

        // Create transaction
        await Transaction.create({
          user: consultation.user,
          type: 'debit',
          category: 'consultation',
          amount: consultation.totalAmount,
          balanceBefore: user.wallet + consultation.totalAmount,
          balanceAfter: user.wallet,
          status: 'completed',
          description: `${consultation.type} consultation with ${provider.fullName}`,
        });
      }
    }

    await consultation.save();

    res.status(200).json({
      success: true,
      message: 'Consultation ended',
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Cancel consultation
// @route   PUT /api/consultations/:id/cancel
// @access  Private
const cancelConsultation = async (req, res, next) => {
  try {
    const consultation = await Consultation.findById(req.params.id);

    if (!consultation) {
      return next(new AppError('Consultation not found', 404));
    }

    // Both user and provider can cancel pending consultations
    const isUser = consultation.user.toString() === req.user?._id.toString();
    const isProvider = consultation.provider.toString() === req.user?._id.toString();
    
    if (!isUser && !isProvider) {
      return next(new AppError('Not authorized', 403));
    }

    if (consultation.status !== 'pending') {
      return next(new AppError('Cannot cancel ongoing or completed consultations', 400));
    }

    consultation.status = 'cancelled';
    await consultation.save();

    // Different message based on who cancelled
    const message = isUser ? 'Consultation cancelled' : 'Consultation request rejected';

    res.status(200).json({
      success: true,
      message,
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createConsultation,
  getConsultation,
  getMyConsultations,
  startConsultation,
  endConsultation,
  cancelConsultation,
  getConsultationHistory,
};

