const { User, Guest, Consultation, Transaction, Withdrawal } = require('../models');
const mongoose = require('mongoose');

// Get overview analytics
const getOverviewAnalytics = async (req, res) => {
  try {
    const { dateRange = '30d' } = req.query;
    
    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch (dateRange) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get total users (providers + regular users + guests)
    const totalProviders = await User.countDocuments({ role: 'provider' });
    const totalRegularUsers = await User.countDocuments({ role: 'user' });
    const totalGuests = await Guest.countDocuments();
    const totalUsers = totalProviders + totalRegularUsers + totalGuests;

    console.log('🔍 Analytics Debug - User Counts:');
    console.log(`- Total Providers: ${totalProviders}`);
    console.log(`- Total Regular Users: ${totalRegularUsers}`);
    console.log(`- Total Guests: ${totalGuests}`);
    console.log(`- Total Users: ${totalUsers}`);

    // Debug: Check what roles exist in the database
    const roleDistribution = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    console.log('🔍 Role Distribution:', roleDistribution);

    // Get new users today
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const newUsersToday = await User.countDocuments({ 
      createdAt: { $gte: todayStart } 
    }) + await Guest.countDocuments({ 
      createdAt: { $gte: todayStart } 
    });

    // Get total revenue from consultations
    const revenueResult = await Consultation.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' } } }
    ]);
    const totalRevenue = revenueResult[0]?.totalRevenue || 0;

    // Get monthly revenue
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyRevenueResult = await Consultation.aggregate([
      { 
        $match: { 
          status: 'completed',
          createdAt: { $gte: monthStart }
        } 
      },
      { $group: { _id: null, monthlyRevenue: { $sum: '$totalAmount' } } }
    ]);
    const monthlyRevenue = monthlyRevenueResult[0]?.monthlyRevenue || 0;

    // Get total consultations
    const totalConsultations = await Consultation.countDocuments();

    // Get consultations today
    const consultationsToday = await Consultation.countDocuments({
      createdAt: { $gte: todayStart }
    });

    // Get average rating
    const ratingResult = await Consultation.aggregate([
      { $match: { rating: { $exists: true, $ne: null } } },
      { $group: { _id: null, averageRating: { $avg: '$rating' } } }
    ]);
    const averageRating = ratingResult[0]?.averageRating || 0;

    // Get active providers (those who had consultations in the last 30 days)
    const activeProviders = await Consultation.distinct('provider', {
      createdAt: { $gte: startDate }
    });

    res.json({
      success: true,
      data: {
        totalUsers,
        newUsersToday,
        totalRevenue,
        monthlyRevenue,
        totalConsultations,
        consultationsToday,
        averageRating: Math.round(averageRating * 10) / 10,
        activeProviders: activeProviders.length,
        totalProviders,
        totalGuests
      }
    });

  } catch (error) {
    console.error('Error fetching overview analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch overview analytics'
    });
  }
};

// Get user growth analytics
const getUserGrowthAnalytics = async (req, res) => {
  try {
    const { dateRange = '6m' } = req.query;
    
    // Get monthly user growth for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const userGrowth = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          newUsers: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1 }
      }
    ]);

    const guestGrowth = await Guest.aggregate([
      {
        $match: {
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          newGuests: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1 }
      }
    ]);

    // Combine and format data
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const growthData = [];
    
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      
      const userEntry = userGrowth.find(u => u._id.year === year && u._id.month === month);
      const guestEntry = guestGrowth.find(g => g._id.year === year && g._id.month === month);
      
      growthData.push({
        month: `${monthNames[month - 1]} ${year}`,
        newUsers: (userEntry?.newUsers || 0) + (guestEntry?.newGuests || 0),
        newProviders: userEntry?.newUsers || 0,
        newGuests: guestEntry?.newGuests || 0
      });
    }

    res.json({
      success: true,
      data: growthData
    });

  } catch (error) {
    console.error('Error fetching user growth analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user growth analytics'
    });
  }
};

// Get revenue analytics
const getRevenueAnalytics = async (req, res) => {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const revenueData = await Consultation.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          revenue: { $sum: '$totalAmount' },
          consultations: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1 }
      }
    ]);

    // Format data
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formattedData = [];
    
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      
      const entry = revenueData.find(r => r._id.year === year && r._id.month === month);
      const revenue = entry?.revenue || 0;
      const commissions = Math.round(revenue * 0.15); // Assuming 15% commission
      
      formattedData.push({
        month: `${monthNames[month - 1]} ${year}`,
        revenue,
        commissions,
        consultations: entry?.consultations || 0
      });
    }

    res.json({
      success: true,
      data: formattedData
    });

  } catch (error) {
    console.error('Error fetching revenue analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch revenue analytics'
    });
  }
};

// Get category performance analytics
const getCategoryAnalytics = async (req, res) => {
  try {
    const categoryData = await Consultation.aggregate([
      {
        $match: { status: 'completed' }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'provider',
          foreignField: '_id',
          as: 'providerData'
        }
      },
      {
        $unwind: '$providerData'
      },
      {
        $group: {
          _id: '$providerData.profession',
          consultations: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
          providers: { $addToSet: '$provider' }
        }
      },
      {
        $project: {
          name: '$_id',
          consultations: 1,
          revenue: 1,
          providers: { $size: '$providers' }
        }
      },
      {
        $sort: { revenue: -1 }
      }
    ]);

    res.json({
      success: true,
      data: categoryData
    });

  } catch (error) {
    console.error('Error fetching category analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch category analytics'
    });
  }
};

// Get provider earnings analytics
const getProviderAnalytics = async (req, res) => {
  try {
    const providerEarnings = await Consultation.aggregate([
      {
        $match: { status: 'completed' }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'provider',
          foreignField: '_id',
          as: 'providerData'
        }
      },
      {
        $unwind: '$providerData'
      },
      {
        $group: {
          _id: '$provider',
          name: { $first: '$providerData.fullName' },
          earnings: { $sum: '$totalAmount' },
          consultations: { $sum: 1 },
          averageRating: { $avg: '$rating.stars' }
        }
      },
      {
        $sort: { earnings: -1 }
      },
      {
        $limit: 10
      }
    ]);

    res.json({
      success: true,
      data: providerEarnings
    });

  } catch (error) {
    console.error('Error fetching provider analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch provider analytics'
    });
  }
};

// Get daily activity analytics
const getDailyActivityAnalytics = async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyActivity = await Consultation.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            dayOfWeek: { $dayOfWeek: '$createdAt' },
            date: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt'
              }
            }
          },
          consultations: { $sum: 1 },
          users: { $addToSet: '$userId' }
        }
      },
      {
        $project: {
          dayOfWeek: '$_id.dayOfWeek',
          date: '$_id.date',
          consultations: 1,
          users: { $size: '$users' }
        }
      },
      {
        $sort: { date: 1 }
      }
    ]);

    // Format with day names
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const formattedData = dailyActivity.map(day => ({
      day: dayNames[day.dayOfWeek - 1],
      date: day.date,
      consultations: day.consultations,
      users: day.users
    }));

    res.json({
      success: true,
      data: formattedData
    });

  } catch (error) {
    console.error('Error fetching daily activity analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch daily activity analytics'
    });
  }
};

// Export analytics data
const exportAnalytics = async (req, res) => {
  try {
    const { reportType, dateRange = '30d' } = req.query;
    
    // This would generate and return a downloadable report
    // For now, we'll just return a success message
    
    res.json({
      success: true,
      message: `${reportType} report exported successfully`,
      downloadUrl: `/api/analytics/download/${reportType}?dateRange=${dateRange}`
    });

  } catch (error) {
    console.error('Error exporting analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export analytics'
    });
  }
};

module.exports = {
  getOverviewAnalytics,
  getUserGrowthAnalytics,
  getRevenueAnalytics,
  getCategoryAnalytics,
  getProviderAnalytics,
  getDailyActivityAnalytics,
  exportAnalytics
};