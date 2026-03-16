const { User, Consultation } = require('../models');
const Report = require('../models/Report.model');
const { AppError } = require('../middlewares/errorHandler');
const { sendReportNotificationEmail, sendWarningEmail } = require('../utils/sendEmail');
const { createNotification } = require('../utils/notifications');

// @desc    Submit report and optionally block user
// @route   POST /api/reports
// @access  Private
const submitReport = async (req, res, next) => {
  try {
    const { reportedUserId, consultationId, reason, description, shouldBlock } = req.body;
    const reporterId = req.user._id;

    console.log('📝 Report submission received:', {
      reporterId,
      reportedUserId,
      consultationId,
      reason,
      shouldBlock,
    });

    // Validation
    if (!reportedUserId || !consultationId || !reason || !description) {
      console.error('❌ Validation failed - missing fields:', {
        hasReportedUserId: !!reportedUserId,
        hasConsultationId: !!consultationId,
        hasReason: !!reason,
        hasDescription: !!description,
      });
      return next(new AppError('All fields are required', 400));
    }

    // Check if consultation exists
    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      console.error('❌ Consultation not found:', consultationId);
      return next(new AppError('Consultation not found', 404));
    }

    console.log('✅ Consultation found:', {
      id: consultation._id,
      user: consultation.user,
      provider: consultation.provider,
    });

    // Verify reporter was part of the consultation
    const isParticipant = 
      consultation.user?.toString() === reporterId.toString() ||
      consultation.provider?.toString() === reporterId.toString();

    if (!isParticipant) {
      console.error('❌ User not participant in consultation:', {
        reporterId,
        consultationUser: consultation.user,
        consultationProvider: consultation.provider,
      });
      return next(new AppError('You can only report users from your consultations', 403));
    }

    console.log('✅ User is participant in consultation');

    // Check if user exists
    const reportedUser = await User.findById(reportedUserId);
    if (!reportedUser) {
      return next(new AppError('Reported user not found', 404));
    }

    // Create report
    const report = await Report.create({
      reporter: reporterId,
      reported: reportedUserId,
      consultation: consultationId,
      reason,
      description,
      isBlocked: shouldBlock || false,
    });

    // If shouldBlock is true, add to blocked users
    if (shouldBlock) {
      const reporter = await User.findById(reporterId);
      
      // Check if already blocked
      const alreadyBlocked = reporter.blockedUsers.some(
        (blocked) => blocked.userId.toString() === reportedUserId.toString()
      );

      if (!alreadyBlocked) {
        reporter.blockedUsers.push({
          userId: reportedUserId,
          blockedAt: new Date(),
          reason: reason,
        });
        await reporter.save();
      }
    }

    // Count total reports against this user
    const totalReports = await Report.countDocuments({
      reported: reportedUserId,
      status: { $in: ['pending', 'reviewed'] },
    });

    // Send notification to admin
    await createNotification({
      userId: 'admin', // Special admin notification
      userType: 'admin',
      title: 'New User Report',
      message: `User ${req.user.fullName} reported ${reportedUser.fullName}. Total reports: ${totalReports}`,
      type: 'admin',
      data: {
        reportId: report._id,
        reporterId,
        reportedUserId,
        reason,
        totalReports,
        isBlocked: shouldBlock,
        action: 'new_report',
      },
    });

    // Send email notification to admin
    try {
      await sendReportNotificationEmail({
        reporterName: req.user.fullName,
        reportedName: reportedUser.fullName,
        reportedEmail: reportedUser.email,
        reason,
        description,
        totalReports,
        isBlocked: shouldBlock,
        reportId: report._id,
      });
    } catch (emailError) {
      console.error('Failed to send report email:', emailError);
    }

    // Auto-send warning if this is the first, second, or third report
    if (totalReports <= 3) {
      try {
        // Fetch full report history for dynamic email
        const allReportsAgainstUser = await Report.find({ reported: reportedUserId })
          .populate('reporter', 'fullName')
          .sort({ createdAt: -1 });

        const totalBlocks = allReportsAgainstUser.filter(r => r.isBlocked).length;
        const reportHistory = allReportsAgainstUser.map(r => ({
          reason: r.reason,
          date: r.createdAt,
          reporterName: r.reporter?.fullName || 'Anonymous',
          isBlocked: r.isBlocked,
        }));

        await sendWarningEmail({
          userName: reportedUser.fullName,
          userEmail: reportedUser.email,
          warningNumber: totalReports,
          reason,
          totalReports,
          totalBlocks,
          reportHistory,
        });

        // Update report with warning sent
        report.warningsSent = totalReports;
        report.actionTaken = 'warning';
        await report.save();
      } catch (emailError) {
        console.error('Failed to send warning email:', emailError);
      }
    }

    res.status(201).json({
      success: true,
      message: shouldBlock 
        ? 'Report submitted and user blocked successfully' 
        : 'Report submitted successfully',
      data: {
        report,
        totalReports,
        warningLevel: totalReports <= 3 ? totalReports : 'requires_admin_action',
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all reports (Admin only)
// @route   GET /api/reports
// @access  Private/Admin
const getAllReports = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, reportedUserId } = req.query;

    const query = {};
    if (status) query.status = status;
    if (reportedUserId) query.reported = reportedUserId;

    const reports = await Report.find(query)
      .populate('reporter', 'fullName email mobile profilePhoto')
      .populate('reported', 'fullName email mobile profilePhoto')
      .populate('consultation', 'type duration startTime')
      .populate('reviewedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Report.countDocuments(query);

    // Get statistics
    const stats = await Report.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: reports,
      stats,
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

// @desc    Get reports for a specific user (Admin only)
// @route   GET /api/reports/user/:userId
// @access  Private/Admin
const getUserReports = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const reports = await Report.find({ reported: userId })
      .populate('reporter', 'fullName email mobile')
      .populate('consultation', 'type duration startTime')
      .sort({ createdAt: -1 });

    const totalReports = reports.length;
    const pendingReports = reports.filter((r) => r.status === 'pending').length;
    const warningsSent = Math.max(...reports.map((r) => r.warningsSent), 0);

    res.status(200).json({
      success: true,
      data: {
        reports,
        summary: {
          totalReports,
          pendingReports,
          warningsSent,
          requiresAction: totalReports > 3 && pendingReports > 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Take action on report (Admin only)
// @route   PUT /api/reports/:id/action
// @access  Private/Admin
const takeActionOnReport = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, adminNotes } = req.body;
    const adminId = req.user._id;

    console.log('🎯 takeActionOnReport called:', {
      reportId: id,
      action,
      hasAdminNotes: !!adminNotes,
      adminId,
    });

    if (!action || !['warning', 'suspended', 'dismissed'].includes(action)) {
      return next(new AppError('Valid action is required (warning, suspended, dismissed)', 400));
    }

    const report = await Report.findById(id).populate('reported', 'fullName email');
    if (!report) {
      console.error('❌ Report not found:', id);
      return next(new AppError('Report not found', 404));
    }

    console.log('✅ Report found:', {
      reportId: report._id,
      reportedUser: report.reported.fullName,
      reportedEmail: report.reported.email,
    });

    // Count total reports for this user
    const totalReports = await Report.countDocuments({
      reported: report.reported._id,
      status: { $in: ['pending', 'reviewed'] },
    });

    // Update report
    report.status = action === 'dismissed' ? 'dismissed' : 'resolved';
    report.actionTaken = action;
    report.adminNotes = adminNotes;
    report.reviewedBy = adminId;
    report.reviewedAt = new Date();

    if (action === 'warning') {
      report.warningsSent = totalReports;
    }

    await report.save();

    // Take action on user account
    const reportedUser = await User.findById(report.reported._id);

    // Fetch full report history for dynamic email
    const allReportsAgainstUser = await Report.find({ reported: report.reported._id })
      .populate('reporter', 'fullName')
      .sort({ createdAt: -1 });

    const totalBlocks = allReportsAgainstUser.filter(r => r.isBlocked).length;
    const reportHistory = allReportsAgainstUser.map(r => ({
      reason: r.reason,
      date: r.createdAt,
      reporterName: r.reporter?.fullName || 'Anonymous',
      isBlocked: r.isBlocked,
    }));

    if (action === 'suspended') {
      reportedUser.status = 'suspended';
      await reportedUser.save();
      console.log('✅ User suspended:', reportedUser.fullName);

      // Send suspension email
      console.log('📧 Attempting to send suspension email...');
      try {
        const emailResult = await sendWarningEmail({
          userName: reportedUser.fullName,
          userEmail: reportedUser.email,
          warningNumber: 'suspended',
          reason: report.reason,
          adminNotes,
          totalReports,
          totalBlocks,
          reportHistory,
        });
        console.log('✅ Suspension email sent:', emailResult);
      } catch (emailError) {
        console.error('❌ Failed to send suspension email:', emailError);
        console.error('❌ Email error stack:', emailError.stack);
      }
    } else if (action === 'warning') {
      // Send warning email
      console.log('📧 Attempting to send warning email...');
      try {
        const emailResult = await sendWarningEmail({
          userName: reportedUser.fullName,
          userEmail: reportedUser.email,
          warningNumber: totalReports,
          reason: report.reason,
          adminNotes,
          totalReports,
          totalBlocks,
          reportHistory,
        });
        console.log('✅ Warning email sent:', emailResult);
      } catch (emailError) {
        console.error('❌ Failed to send warning email:', emailError);
        console.error('❌ Email error stack:', emailError.stack);
      }
    }

    // Send notification to reported user
    await createNotification({
      userId: report.reported._id,
      userType: 'user',
      title: action === 'suspended' ? 'Account Suspended' : 'Warning Received',
      message: action === 'suspended' 
        ? 'Your account has been suspended due to multiple reports'
        : `You have received a warning (${totalReports}/3)`,
      type: 'system',
      data: {
        action,
        reportId: report._id,
        warningNumber: totalReports,
      },
    });

    res.status(200).json({
      success: true,
      message: `Action taken successfully: ${action}`,
      data: report,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get my blocked users
// @route   GET /api/reports/blocked
// @access  Private
const getBlockedUsers = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate(
      'blockedUsers.userId',
      'fullName profilePhoto'
    );

    res.status(200).json({
      success: true,
      data: user.blockedUsers,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Unblock user
// @route   DELETE /api/reports/blocked/:userId
// @access  Private
const unblockUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(req.user._id);

    user.blockedUsers = user.blockedUsers.filter(
      (blocked) => blocked.userId.toString() !== userId
    );

    await user.save();

    res.status(200).json({
      success: true,
      message: 'User unblocked successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  submitReport,
  getAllReports,
  getUserReports,
  takeActionOnReport,
  getBlockedUsers,
  unblockUser,
};
