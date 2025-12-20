const { Subscription, User, Transaction, Settings } = require('../models');
const { AppError } = require('../middlewares/errorHandler');

// @desc    Get all subscription plans
// @route   GET /api/subscriptions
// @access  Public
const getSubscriptions = async (req, res, next) => {
  try {
    const { type } = req.query;

    const query = { isActive: true };
    if (type) query.type = type;

    const subscriptions = await Subscription.find(query).sort({ displayOrder: 1, price: 1 });

    res.status(200).json({
      success: true,
      data: subscriptions,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Purchase subscription
// @route   POST /api/subscriptions/purchase
// @access  Private
const purchaseSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.body;

    const subscription = await Subscription.findById(subscriptionId);
    if (!subscription) {
      return next(new AppError('Subscription plan not found', 404));
    }

    const user = await User.findById(req.user?._id);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Check if user already has active subscription
    if (user.subscription?.isActive) {
      return next(new AppError('You already have an active subscription', 400));
    }

    // Check wallet balance
    if (user.wallet < subscription.price) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    // Deduct from wallet
    const balanceBefore = user.wallet;
    user.wallet -= subscription.price;

    // Activate subscription
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + subscription.duration);

    user.subscription = {
      plan: subscription._id,
      startDate,
      endDate,
      isActive: true,
    };

    await user.save();

    // Create transaction
    await Transaction.create({
      user: user._id,
      userType: 'User',
      type: 'debit',
      category: 'subscription',
      amount: subscription.price,
      balance: user.wallet, // Balance after transaction
      status: 'completed',
      description: `Subscription: ${subscription.name}`,
      transactionId: `SUB_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    });

    res.status(200).json({
      success: true,
      message: 'Subscription activated successfully',
      data: {
        subscription: user.subscription,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get user's active subscription
// @route   GET /api/subscriptions/my-subscription
// @access  Private
const getMySubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.user?._id).populate('subscription.plan');

    if (!user?.subscription?.isActive) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No active subscription',
      });
    }

    // Check if subscription has expired
    if (user.subscription.endDate && user.subscription.endDate < new Date()) {
      user.subscription.isActive = false;
      await user.save();

      return res.status(200).json({
        success: true,
        data: null,
        message: 'Subscription expired',
      });
    }

    res.status(200).json({
      success: true,
      data: user.subscription,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Cancel subscription
// @route   POST /api/subscriptions/cancel
// @access  Private
const cancelSubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.user?._id);

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    if (!user.subscription?.isActive) {
      return next(new AppError('No active subscription found', 404));
    }

    user.subscription.isActive = false;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Subscription cancelled successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create subscription plan (Admin)
// @route   POST /api/subscriptions/admin/create
// @access  Private/Admin
const createSubscriptionPlan = async (req, res, next) => {
  try {
    const subscription = await Subscription.create(req.body);

    res.status(201).json({
      success: true,
      message: 'Subscription plan created successfully',
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update subscription plan (Admin)
// @route   PUT /api/subscriptions/admin/:id
// @access  Private/Admin
const updateSubscriptionPlan = async (req, res, next) => {
  try {
    const subscription = await Subscription.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!subscription) {
      return next(new AppError('Subscription plan not found', 404));
    }

    res.status(200).json({
      success: true,
      message: 'Subscription plan updated successfully',
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete subscription plan (Admin)
// @route   DELETE /api/subscriptions/admin/:id
// @access  Private/Admin
const deleteSubscriptionPlan = async (req, res, next) => {
  try {
    const subscription = await Subscription.findByIdAndDelete(req.params.id);

    if (!subscription) {
      return next(new AppError('Subscription plan not found', 404));
    }

    res.status(200).json({
      success: true,
      message: 'Subscription plan deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get subscription revenue stats (Admin)
// @route   GET /api/subscriptions/admin/revenue
// @access  Private/Admin
const getSubscriptionRevenue = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const matchQuery = {
      category: 'subscription',
      status: 'completed',
    };

    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
      if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
    }

    const revenue = await Transaction.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    const planBreakdown = await Transaction.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$description',
          revenue: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: revenue[0]?.totalRevenue || 0,
        totalSubscriptions: revenue[0]?.count || 0,
        planBreakdown,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get active subscribers (Admin)
// @route   GET /api/subscriptions/admin/subscribers
// @access  Private/Admin
const getActiveSubscribers = async (req, res, next) => {
  try {
    const { type, page = 1, limit = 20 } = req.query;

    const query = {
      'subscription.isActive': true,
      'subscription.endDate': { $gte: new Date() },
    };

    if (type === 'user') {
      query.isServiceProvider = false;
    } else if (type === 'provider') {
      query.isServiceProvider = true;
    }

    const subscribers = await User.find(query)
      .select('fullName email mobile subscription isServiceProvider')
      .populate('subscription.plan')
      .sort({ 'subscription.startDate': -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: subscribers,
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

module.exports = {
  getSubscriptions,
  purchaseSubscription,
  getMySubscription,
  cancelSubscription,
  createSubscriptionPlan,
  updateSubscriptionPlan,
  deleteSubscriptionPlan,
  getSubscriptionRevenue,
  getActiveSubscribers,
};

