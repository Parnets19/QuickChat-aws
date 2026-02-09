const {
  User,
  Guest,
  EarningsTransaction,
  WithdrawalRequest,
  Consultation,
  Transaction,
  Withdrawal,
} = require("../models");
const { logger } = require("../utils/logger");

// Get earnings overview
const getEarningsOverview = async (req, res) => {
  try {
    console.log(
      "🔍 BACKEND: Getting earnings overview for user:",
      req.user.id || req.user._id
    );
    const userId = req.user.id || req.user._id;

    // Get user with wallet and earnings
    const user = await User.findById(userId).select("wallet earnings");
    console.log("👤 BACKEND: User found:", user ? "Yes" : "No");
    if (user) {
      console.log(
        "💰 BACKEND: User wallet:",
        user.wallet,
        "earnings:",
        user.earnings
      );
    }

    if (!user) {
      console.log("❌ BACKEND: User not found");
      return res.status(404).json({ message: "User not found" });
    }

    // Get current month date range
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );

    console.log(
      "📅 BACKEND: Checking monthly data from",
      startOfMonth,
      "to",
      endOfMonth
    );

    // ===== EARNINGS DATA (as a provider) =====

    // 1. From earnings transactions
    const monthlyEarningsFromTransactions = await EarningsTransaction.aggregate(
      [
        {
          $match: {
            userId: user._id,
            type: "earning",
            status: "completed",
            createdAt: { $gte: startOfMonth, $lte: endOfMonth },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
          },
        },
      ]
    );

    // 2. From completed consultations this month (as provider)
    const monthlyEarningsFromConsultations = await Consultation.aggregate([
      {
        $match: {
          provider: user._id,
          status: "completed",
          createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalAmount" },
        },
      },
    ]);

    const transactionEarnings = monthlyEarningsFromTransactions[0]?.total || 0;
    const consultationEarnings =
      monthlyEarningsFromConsultations[0]?.total || 0;
    const totalMonthlyEarnings = transactionEarnings + consultationEarnings;

    console.log(
      "📊 BACKEND: Monthly earnings from transactions:",
      transactionEarnings
    );
    console.log(
      "📊 BACKEND: Monthly earnings from consultations:",
      consultationEarnings
    );
    console.log("📊 BACKEND: Total monthly earnings:", totalMonthlyEarnings);

    // Get pending earnings (from ongoing consultations)
    const pendingEarnings = await Consultation.aggregate([
      {
        $match: {
          provider: user._id,
          status: "ongoing",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalAmount" },
        },
      },
    ]);

    // Get total withdrawn amount
    const totalWithdrawn = await WithdrawalRequest.aggregate([
      {
        $match: {
          userId: user._id,
          status: { $in: ["processed", "processing"] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$netAmount" },
        },
      },
    ]);

    // ===== SPENDING DATA (as a client) =====

    // Get consultations where this user was the client (spending money)
    const totalSpentOnConsultations = await Consultation.aggregate([
      {
        $match: {
          user: user._id, // User was the client
          status: "completed",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalAmount" },
        },
      },
    ]);

    // Get monthly spending (consultations as client this month)
    const monthlySpentOnConsultations = await Consultation.aggregate([
      {
        $match: {
          user: user._id, // User was the client
          status: "completed",
          createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalAmount" },
        },
      },
    ]);

    // Get spending from Transaction model (wallet debits for consultations)
    const totalSpentFromTransactions = await Transaction.aggregate([
      {
        $match: {
          user: user._id,
          userType: "User",
          type: {
            $in: ["consultation", "consultation_payment", "wallet_debit"],
          },
          status: "completed",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    // Get monthly spending from transactions
    const monthlySpentFromTransactions = await Transaction.aggregate([
      {
        $match: {
          user: user._id,
          userType: "User",
          type: {
            $in: ["consultation", "consultation_payment", "wallet_debit"],
          },
          status: "completed",
          createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    const totalSpentConsultations = totalSpentOnConsultations[0]?.total || 0;
    const totalSpentTransactions = totalSpentFromTransactions[0]?.total || 0;
    const monthlySpentConsultations =
      monthlySpentOnConsultations[0]?.total || 0;
    const monthlySpentTransactions =
      monthlySpentFromTransactions[0]?.total || 0;

    // Check if user has totalSpent field (this might be where the spending is tracked)
    const userTotalSpent = user.totalSpent || 0;

    // Use the highest value among all sources for accuracy
    const totalSpent = Math.max(
      totalSpentConsultations,
      totalSpentTransactions,
      userTotalSpent
    );
    const monthlySpent = Math.max(
      monthlySpentConsultations,
      monthlySpentTransactions
    );

    console.log("💸 BACKEND: === SPENDING CALCULATION DEBUG ===");
    console.log("💸 BACKEND: User.totalSpent field:", userTotalSpent);
    console.log(
      "💸 BACKEND: Total spent on consultations:",
      totalSpentConsultations
    );
    console.log(
      "💸 BACKEND: Total spent from transactions:",
      totalSpentTransactions
    );
    console.log("💸 BACKEND: Final total spent (max):", totalSpent);

    console.log(
      "💸 BACKEND: Total spent on consultations:",
      totalSpentConsultations
    );
    console.log(
      "💸 BACKEND: Total spent from transactions:",
      totalSpentTransactions
    );
    console.log("💸 BACKEND: Monthly spent:", monthlySpent);

    // ===== SIMPLIFIED WALLET CALCULATION =====

    // Get manual deposits (money added to wallet)
    const manualDeposits = await Transaction.aggregate([
      {
        $match: {
          user: user._id,
          userType: "User",
          type: { $in: ["deposit", "wallet_credit", "credit"] },
          status: "completed",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    // SIMPLE CALCULATION:
    // Current wallet balance (from database)
    const currentWalletBalance = user.wallet || 0;

    // Total earnings (from user.earnings field)
    const totalEarnings = user.earnings || 0;

    // Manual deposits (from transactions)
    const totalDeposits = manualDeposits[0]?.total || 0;

    // Total income to wallet
    const totalWalletIncome = totalEarnings + totalDeposits;

    // Total outflow (spending + withdrawals)
    const totalWithdrawals = totalWithdrawn[0]?.total || 0;
    const totalWalletOutflow = totalSpent + totalWithdrawals;

    // Calculate what the wallet balance SHOULD be
    const calculatedBalance = totalWalletIncome - totalWalletOutflow;

    // Retention rate
    const walletRetention =
      totalWalletIncome > 0
        ? (currentWalletBalance / totalWalletIncome) * 100
        : 0;

    console.log("💰 BACKEND: === WALLET CALCULATION DEBUG ===");
    console.log("💰 BACKEND: Total earnings (user.earnings):", totalEarnings);
    console.log("💰 BACKEND: Manual deposits:", totalDeposits);
    console.log("💰 BACKEND: Total wallet income:", totalWalletIncome);
    console.log("💰 BACKEND: Total spent:", totalSpent);
    console.log("💰 BACKEND: Total withdrawals:", totalWithdrawals);
    console.log("💰 BACKEND: Total wallet outflow:", totalWalletOutflow);
    console.log(
      "💰 BACKEND: Current wallet balance (DB):",
      currentWalletBalance
    );
    console.log(
      "💰 BACKEND: Calculated balance (should be):",
      calculatedBalance
    );
    console.log(
      "💰 BACKEND: Difference:",
      currentWalletBalance - calculatedBalance
    );
    console.log(
      "💰 BACKEND: Wallet retention:",
      walletRetention.toFixed(2) + "%"
    );

    // ===== NET CALCULATIONS (SIMPLIFIED) =====
    // Net earnings = Total earned - Total spent (business profit/loss)
    const netEarnings = totalEarnings - totalSpent;
    const netMonthly = totalMonthlyEarnings - monthlySpent;

    console.log("🧮 BACKEND: Net earnings (business):", netEarnings);
    console.log("🧮 BACKEND: Net monthly (business):", netMonthly);

    const stats = {
      // Earnings (as provider)
      totalEarnings: totalEarnings,
      thisMonth: totalMonthlyEarnings,
      pending: pendingEarnings[0]?.total || 0,

      // Spending (as client)
      totalSpent: totalSpent,
      monthlySpent: monthlySpent,

      // Net calculations
      netEarnings: netEarnings,
      netMonthly: netMonthly,

      // Wallet & withdrawals
      walletBalance: currentWalletBalance,
      withdrawn: totalWithdrawals,

      // Wallet flow analysis (simplified and correct)
      walletDeposits: totalDeposits,
      walletWithdrawals: totalWithdrawals,
      totalWalletIncome: totalWalletIncome,
      totalWalletOutflow: totalWalletOutflow,
      walletRetention: Math.round(walletRetention * 100) / 100,
      earningsToWallet: totalEarnings,

      // Debug information
      calculatedBalance: calculatedBalance,
      balanceDifference: currentWalletBalance - calculatedBalance,
    };

    // Check if user has any completed consultations
    const completedConsultations = await Consultation.find({
      provider: user._id,
      status: "completed",
    }).limit(5);

    console.log(
      "📋 BACKEND: Completed consultations:",
      completedConsultations.length
    );

    // If user has no earnings but has completed consultations, let's add them
    if (user.earnings === 0 && completedConsultations.length > 0) {
      console.log(
        "🔧 BACKEND: User has completed consultations but no earnings, updating..."
      );

      let totalEarningsToAdd = 0;
      for (const consultation of completedConsultations) {
        if (consultation.totalAmount && consultation.totalAmount > 0) {
          totalEarningsToAdd += consultation.totalAmount;

          // Check if transaction already exists
          const existingTransaction = await EarningsTransaction.findOne({
            userId: user._id,
            consultationId: consultation._id,
          });

          if (!existingTransaction) {
            // Create earnings transaction
            await EarningsTransaction.create({
              user: user._id,
              userType: "User",
              userId: user._id, // Keep for backward compatibility
              consultationId: consultation._id,
              type: "earning",
              category: "consultation",
              amount: consultation.totalAmount,
              balance: user.wallet + consultation.totalAmount, // Balance after earning
              description: `${
                consultation.type.charAt(0).toUpperCase() +
                consultation.type.slice(1)
              } Consultation`,
              status: "completed",
              metadata: {
                consultationType: consultation.type,
                duration: consultation.duration,
                rate: consultation.rate,
              },
            });
            console.log(
              "✅ BACKEND: Created earnings transaction for consultation:",
              consultation._id
            );
          }
        }
      }

      if (totalEarningsToAdd > 0) {
        // Update user earnings and wallet
        user.earnings = (user.earnings || 0) + totalEarningsToAdd;
        user.wallet = (user.wallet || 0) + totalEarningsToAdd;
        await user.save();

        console.log(
          "✅ BACKEND: Updated user earnings:",
          user.earnings,
          "wallet:",
          user.wallet
        );

        // Update stats
        stats.totalEarnings = user.earnings;
        stats.walletBalance = user.wallet;
      }
    }

    console.log("📊 BACKEND: Final stats being sent:", stats);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Error getting earnings overview:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get transaction history
const getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { page = 1, limit = 20, type, status } = req.query;

    console.log("📊 TRANSACTION HISTORY REQUEST:", {
      userId,
      page,
      limit,
      type,
      status,
    });

    // Get transactions from both models and combine them

    // 1. Get EarningsTransaction records (earnings, withdrawals)
    const earningsQuery = { userId: userId };
    if (type) earningsQuery.type = type;
    if (status) earningsQuery.status = status;

    const earningsTransactions = await EarningsTransaction.find(earningsQuery)
      .populate("consultationId", "type duration")
      .sort({ createdAt: -1 })
      .lean();

    console.log("💰 EARNINGS TRANSACTIONS:", earningsTransactions.length);

    // 2. Get Transaction records (deposits, payments, etc.)
    const transactionQuery = {
      user: userId,
      userType: "User",
    };
    if (type) transactionQuery.type = type;
    if (status) transactionQuery.status = status;

    const walletTransactions = await Transaction.find(transactionQuery)
      .sort({ createdAt: -1 })
      .lean();

    console.log("💳 WALLET TRANSACTIONS:", walletTransactions.length);

    // 3. Combine and normalize the transactions
    const allTransactions = [
      // EarningsTransaction records
      ...earningsTransactions.map((tx) => ({
        _id: tx._id,
        type: tx.type,
        amount: tx.amount,
        description: tx.description,
        status: tx.status,
        createdAt: tx.createdAt,
        consultationId: tx.consultationId,
        metadata: tx.metadata,
        source: "earnings", // To identify the source
      })),
      // Transaction records
      ...walletTransactions.map((tx) => ({
        _id: tx._id,
        type: tx.type,
        amount: tx.amount,
        description: tx.description,
        status: tx.status,
        createdAt: tx.createdAt,
        balance: tx.balance,
        paymentMethod: tx.paymentMethod,
        paymentGateway: tx.paymentGateway,
        metadata: tx.metadata,
        source: "wallet", // To identify the source
      })),
    ];

    // 4. Sort by creation date (newest first)
    allTransactions.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    // 5. Apply pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedTransactions = allTransactions.slice(startIndex, endIndex);

    console.log("📋 COMBINED TRANSACTIONS:", {
      total: allTransactions.length,
      earnings: earningsTransactions.length,
      wallet: walletTransactions.length,
      paginated: paginatedTransactions.length,
    });

    res.json({
      success: true,
      data: {
        transactions: paginatedTransactions,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(allTransactions.length / limit),
          total: allTransactions.length,
        },
      },
    });
  } catch (error) {
    console.error("❌ ERROR getting transaction history:", error);
    logger.error("Error getting transaction history:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    });
  }
};

// Get withdrawal history
const getWithdrawalHistory = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;
    const { page = 1, limit = 20, status } = req.query;

    const userType = isGuest ? "Guest" : "User";

    console.log("📊 WITHDRAWAL HISTORY REQUEST:", {
      userId,
      userType,
      page,
      limit,
      status,
    });

    // Query both old WithdrawalRequest and new Withdrawal models for backward compatibility
    const query = {
      $or: [
        { user: userId, userType: userType },
        { userId: userId }, // Legacy field
      ],
    };

    if (status) query.status = status;

    // Get withdrawals from the Withdrawal model
    const withdrawals = await Withdrawal.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Withdrawal.countDocuments(query);

    console.log("💰 WITHDRAWAL HISTORY RESULT:", {
      withdrawalsFound: withdrawals.length,
      totalCount: total,
      userType,
    });

    res.json({
      success: true,
      data: {
        withdrawals,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total,
        },
      },
    });
  } catch (error) {
    console.error("❌ ERROR getting withdrawal history:", error);
    logger.error("Error getting withdrawal history:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    });
  }
};

// Request withdrawal
const requestWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;
    const { amount, bankDetails } = req.body;

    console.log("💰 WITHDRAWAL REQUEST:", {
      userId,
      isGuest,
      amount,
      hasBankDetails: !!bankDetails,
    });

    // Validate amount
    if (!amount || amount < 100) {
      return res.status(400).json({
        success: false,
        message: "Minimum withdrawal amount is ₹100",
      });
    }

    let user, userModel;

    if (isGuest) {
      // Handle guest withdrawal
      user = await Guest.findById(userId);
      userModel = "Guest";

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "Guest not found",
        });
      }
    } else {
      // Handle regular user withdrawal
      user = await User.findById(userId);
      userModel = "User";

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
    }

    console.log("👤 User found:", {
      id: user._id,
      name: user.fullName,
      wallet: user.wallet,
      userType: userModel,
    });

    // Check wallet balance
    if (!user.wallet || user.wallet < amount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance",
        data: {
          currentBalance: user.wallet || 0,
          requestedAmount: amount,
        },
      });
    }

    // For regular users (providers), apply 75% withdrawal policy
    let maxWithdrawableAmount = user.wallet;
    let minimumBalance = 0;

    if (!isGuest) {
      // Providers can only withdraw 75% of their wallet balance
      maxWithdrawableAmount = Math.floor(user.wallet * 0.75);
      minimumBalance = user.wallet - maxWithdrawableAmount;

      if (amount > maxWithdrawableAmount) {
        return res.status(400).json({
          success: false,
          message: `You can only withdraw up to 75% of your wallet balance. Maximum withdrawable amount: ₹${maxWithdrawableAmount}`,
          data: {
            currentBalance: user.wallet,
            maxWithdrawable: maxWithdrawableAmount,
            minimumBalance,
            requestedAmount: amount,
          },
        });
      }
    }

    // Validate bank details
    let finalBankDetails;
    if (bankDetails) {
      // Use provided bank details
      if (
        !bankDetails.accountNumber ||
        !bankDetails.accountHolderName
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Complete bank details are required (account number, account holder name)",
        });
      }
      finalBankDetails = bankDetails;
    } else if (user.bankDetails && user.bankDetails.accountNumber) {
      // Use saved bank details
      finalBankDetails = user.bankDetails;
    } else {
      return res.status(400).json({
        success: false,
        message: "Please provide bank details for withdrawal",
      });
    }

    // Calculate processing fee (2% for providers, 1% for guests)
    const feePercentage = isGuest ? 0.01 : 0.02;
    const processingFee = Math.round(amount * feePercentage);
    const netAmount = amount - processingFee;

    // 🛡️ WALLET PROTECTION: Check balance before withdrawal
    if (user.wallet < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Available: ₹${user.wallet}, Requested: ₹${amount}`,
        data: {
          currentBalance: user.wallet,
          requestedAmount: amount,
          shortfall: amount - user.wallet,
        },
      });
    }

    // IMMEDIATE DEDUCTION: Deduct money from wallet when withdrawal is requested
    console.log(
      "💰 IMMEDIATE DEDUCTION: Deducting withdrawal amount from wallet",
      {
        userId: user._id,
        currentWallet: user.wallet,
        withdrawalAmount: amount,
        newWallet: user.wallet - amount,
      }
    );

    user.wallet -= amount;

    // 🛡️ SAFETY CHECK: Ensure wallet never goes negative
    if (user.wallet < 0) {
      console.log("🚨 WALLET WENT NEGATIVE AFTER WITHDRAWAL - CORRECTING:", {
        userId: user._id,
        walletBefore: user.wallet + amount,
        walletAfter: user.wallet,
        correction: "Setting to 0",
      });
      user.wallet = 0;
    }

    await user.save();

    // Create withdrawal request using the Withdrawal model
    const withdrawal = new Withdrawal({
      user: userId,
      userType: userModel,
      userId: userId, // Legacy field
      amount,
      processingFee,
      netAmount,
      bankDetails: finalBankDetails,
      status: "pending",
    });

    await withdrawal.save();

    // Create transaction record as completed (money already deducted)
    const transaction = new Transaction({
      user: userId,
      userType: userModel,
      type: "withdrawal",
      category: "withdrawal",
      amount: -amount,
      balance: user.wallet, // New balance after deduction
      description: `Withdrawal request - ${
        finalBankDetails.bankName || "Bank"
      } ****${finalBankDetails.accountNumber.slice(-4)}`,
      status: "pending", // Still pending admin approval, but money is deducted
      metadata: {
        withdrawalId: withdrawal._id,
        bankDetails: {
          accountNumber: finalBankDetails.accountNumber.slice(-4),
          ifscCode: finalBankDetails.ifscCode,
          accountHolderName: finalBankDetails.accountHolderName,
        },
        immediateDeduction: true, // Flag to indicate money was deducted immediately
        originalBalance: user.wallet + amount, // Store original balance for potential refund
      },
    });

    await transaction.save();

    console.log("✅ WITHDRAWAL REQUEST CREATED WITH IMMEDIATE DEDUCTION:", {
      withdrawalId: withdrawal._id,
      amount,
      netAmount,
      status: "pending",
      userType: userModel,
      walletDeducted: "Amount deducted immediately",
      newWalletBalance: user.wallet,
    });

    res.json({
      success: true,
      message:
        "Withdrawal request submitted successfully. Amount has been deducted from your wallet and will be processed after admin approval.",
      data: {
        withdrawalId: withdrawal._id,
        amount,
        processingFee,
        netAmount,
        status: "pending",
        userType: userModel,
        maxWithdrawable: maxWithdrawableAmount,
        minimumBalance,
        newWalletBalance: user.wallet,
        note: "Amount has been deducted from wallet. If rejected by admin, amount will be refunded.",
      },
    });
  } catch (error) {
    console.error("❌ WITHDRAWAL ERROR:", {
      message: error.message,
      stack: error.stack,
      userId,
      isGuest,
      amount: req.body.amount,
    });
    logger.error("Error requesting withdrawal:", error);
    res.status(500).json({
      success: false,
      message: "Server error while processing withdrawal request",
      error: error.message,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

// Add earnings (called when consultation is completed)
const addEarnings = async (
  userId,
  consultationId,
  amount,
  description,
  metadata = {}
) => {
  try {
    // Update user earnings and wallet
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    user.earnings = (user.earnings || 0) + amount;
    user.wallet = (user.wallet || 0) + amount;
    await user.save();

    // Create transaction record
    const transaction = new EarningsTransaction({
      user: userId,
      userType: "User",
      userId, // Keep for backward compatibility
      consultationId,
      type: "earning",
      category: "consultation",
      amount,
      balance: user.wallet, // Balance after adding earnings
      description,
      status: "completed",
      metadata,
    });

    await transaction.save();

    logger.info(`Added earnings: ₹${amount} for user ${userId}`);
    return transaction;
  } catch (error) {
    logger.error("Error adding earnings:", error);
    throw error;
  }
};

// Get earnings chart data
const getEarningsChart = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { period = "month" } = req.query; // month, week, year

    let startDate, groupBy;
    const now = new Date();

    switch (period) {
      case "week":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        groupBy = { $dayOfYear: "$createdAt" };
        break;
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1);
        groupBy = { $month: "$createdAt" };
        break;
      default: // month
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        groupBy = { $dayOfMonth: "$createdAt" };
    }

    const user = await User.findById(userId);
    const chartData = await EarningsTransaction.aggregate([
      {
        $match: {
          userId: user._id,
          type: "earning",
          status: "completed",
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: groupBy,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    res.json({
      success: true,
      data: chartData,
    });
  } catch (error) {
    logger.error("Error getting earnings chart:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Debug endpoint to check user data
const debugUserEarnings = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const user = await User.findById(userId).select(
      "wallet earnings fullName isServiceProvider"
    );
    const consultations = await Consultation.find({ provider: userId }).limit(
      10
    );
    const transactions = await EarningsTransaction.find({ userId }).limit(10);

    res.json({
      success: true,
      debug: {
        user: {
          id: user._id,
          name: user.fullName,
          isProvider: user.isServiceProvider,
          wallet: user.wallet,
          earnings: user.earnings,
        },
        consultationsCount: consultations.length,
        consultations: consultations.map((c) => ({
          id: c._id,
          type: c.type,
          status: c.status,
          totalAmount: c.totalAmount,
          duration: c.duration,
          createdAt: c.createdAt,
        })),
        transactionsCount: transactions.length,
        transactions: transactions.map((t) => ({
          id: t._id,
          type: t.type,
          amount: t.amount,
          description: t.description,
          createdAt: t.createdAt,
        })),
      },
    });
  } catch (error) {
    logger.error("Error in debug endpoint:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Fix wallet data for a user
const fixUserWallet = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    console.log("🔧 FIXING WALLET: Starting wallet fix for user:", userId);

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    console.log("👤 CURRENT USER DATA:", {
      name: user.fullName,
      wallet: user.wallet,
      earnings: user.earnings,
    });

    // Calculate total earnings from completed consultations
    const completedConsultations = await Consultation.find({
      provider: userId,
      status: "completed",
    });

    let totalEarningsFromConsultations = 0;
    for (const consultation of completedConsultations) {
      if (consultation.totalAmount && consultation.totalAmount > 0) {
        totalEarningsFromConsultations += consultation.totalAmount;
      }
    }

    console.log("💰 CALCULATED EARNINGS:", {
      completedConsultations: completedConsultations.length,
      totalEarningsFromConsultations,
    });

    // Calculate total withdrawals
    const totalWithdrawn = await WithdrawalRequest.aggregate([
      {
        $match: {
          userId: user._id,
          status: { $in: ["processed", "processing"] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    const withdrawnAmount = totalWithdrawn[0]?.total || 0;

    // Calculate correct wallet balance
    const correctWalletBalance =
      totalEarningsFromConsultations - withdrawnAmount;

    console.log("🔧 WALLET CALCULATION:", {
      totalEarnings: totalEarningsFromConsultations,
      totalWithdrawn: withdrawnAmount,
      correctWalletBalance,
    });

    // Update user data
    user.earnings = totalEarningsFromConsultations;
    user.wallet = Math.max(0, correctWalletBalance); // Ensure wallet is never negative
    await user.save();

    console.log("✅ WALLET FIXED:", {
      newEarnings: user.earnings,
      newWallet: user.wallet,
    });

    res.json({
      success: true,
      message: "Wallet data fixed successfully",
      data: {
        oldData: {
          earnings: req.body.oldEarnings || "unknown",
          wallet: req.body.oldWallet || "unknown",
        },
        newData: {
          earnings: user.earnings,
          wallet: user.wallet,
        },
        calculations: {
          totalEarningsFromConsultations,
          withdrawnAmount,
          correctWalletBalance,
        },
      },
    });
  } catch (error) {
    logger.error("Error fixing wallet:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update wallet balance (admin function)
const updateWalletBalance = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { newBalance } = req.body;

    if (newBalance === undefined || newBalance < 0) {
      return res.status(400).json({ message: "Invalid balance amount" });
    }

    console.log(
      "💰 UPDATING WALLET: User:",
      userId,
      "New Balance:",
      newBalance
    );

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const oldBalance = user.wallet || 0;

    // Update wallet balance
    user.wallet = newBalance;
    await user.save();

    console.log("✅ WALLET UPDATED:", {
      oldBalance,
      newBalance,
      difference: newBalance - oldBalance,
    });

    res.json({
      success: true,
      message: "Wallet balance updated successfully",
      data: {
        oldBalance,
        newBalance,
        difference: newBalance - oldBalance,
      },
    });
  } catch (error) {
    logger.error("Error updating wallet balance:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Add money to wallet (recharge)
const addMoneyToWallet = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { amount, description = "Wallet Recharge" } = req.body;

    console.log("💳 WALLET RECHARGE REQUEST:", {
      userId,
      amount,
      description,
      userType: req.user.isGuest ? "Guest" : "User",
    });

    // Validate amount
    if (!amount || isNaN(amount) || amount <= 0) {
      console.log("❌ Invalid amount:", amount);
      return res.status(400).json({
        success: false,
        message: "Invalid amount. Amount must be a positive number.",
      });
    }

    // Convert amount to number to ensure it's numeric
    const numericAmount = parseFloat(amount);
    if (numericAmount <= 0 || numericAmount > 100000) {
      console.log("❌ Amount out of range:", numericAmount);
      return res.status(400).json({
        success: false,
        message: "Amount must be between ₹1 and ₹100,000.",
      });
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      console.log("❌ User not found:", userId);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log("👤 User found:", {
      id: user._id,
      name: user.fullName,
      currentWallet: user.wallet,
    });

    // Store previous balance
    const previousBalance = user.wallet || 0;

    // Add money to wallet
    user.wallet = previousBalance + numericAmount;
    await user.save();

    console.log("💰 Wallet updated:", {
      previousBalance,
      addedAmount: numericAmount,
      newBalance: user.wallet,
    });

    // Create transaction record using the correct Transaction model
    const transaction = new Transaction({
      user: userId,
      userType: "User",
      type: "deposit",
      category: "deposit",
      amount: numericAmount,
      balance: user.wallet,
      description,
      status: "completed",
      paymentMethod: "wallet", // Use 'wallet' instead of 'manual'
      paymentGateway: "manual", // Gateway can be 'manual'
      transactionId: `WALLET_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`, // Generate unique ID
      metadata: {
        rechargeMethod: "manual",
        previousBalance,
        newBalance: user.wallet,
        addedBy: "user",
      },
    });

    await transaction.save();

    console.log("✅ WALLET RECHARGED SUCCESSFULLY:", {
      userId,
      amount: numericAmount,
      previousBalance,
      newBalance: user.wallet,
      transactionId: transaction._id,
    });

    res.json({
      success: true,
      message: "Money added to wallet successfully",
      data: {
        amount: numericAmount,
        previousBalance,
        newBalance: user.wallet,
        transactionId: transaction._id,
        description,
      },
    });
  } catch (error) {
    console.error("❌ ERROR adding money to wallet:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id || req.user?._id,
      requestBody: req.body,
    });

    logger.error("Error adding money to wallet:", error);

    res.status(500).json({
      success: false,
      message: "Server error while adding money to wallet",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    });
  }
};

// Debug wallet calculations
const debugWalletCalculations = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    // Get user
    const user = await User.findById(userId).select("wallet earnings fullName");

    // Get all transactions for this user
    const allTransactions = await Transaction.find({
      user: userId,
      userType: "User",
    })
      .select("type amount status description createdAt")
      .sort({ createdAt: -1 });

    // Get all consultations as provider
    const providerConsultations = await Consultation.find({
      provider: userId,
      status: "completed",
    }).select("totalAmount type createdAt user");

    // Get all consultations as client
    const clientConsultations = await Consultation.find({
      user: userId,
      status: "completed",
    }).select("totalAmount type createdAt provider");

    // Get withdrawals
    const withdrawals = await WithdrawalRequest.find({
      userId: userId,
    }).select("amount netAmount status createdAt");

    // Calculate totals step by step
    const totalEarningsFromConsultations = providerConsultations.reduce(
      (sum, c) => sum + (c.totalAmount || 0),
      0
    );
    const totalSpentOnConsultations = clientConsultations.reduce(
      (sum, c) => sum + (c.totalAmount || 0),
      0
    );
    const totalWithdrawnProcessed = withdrawals
      .filter((w) => ["processed", "processing"].includes(w.status))
      .reduce((sum, w) => sum + (w.amount || 0), 0);

    // Get manual deposits
    const deposits = allTransactions.filter(
      (t) =>
        ["deposit", "wallet_credit", "credit"].includes(t.type) &&
        t.status === "completed"
    );
    const totalDeposits = deposits.reduce((sum, t) => sum + (t.amount || 0), 0);

    // Calculate expected wallet balance
    const totalIncome = totalEarningsFromConsultations + totalDeposits;
    const totalOutflow = totalSpentOnConsultations + totalWithdrawnProcessed;
    const expectedWallet = totalIncome - totalOutflow;

    res.json({
      success: true,
      debug: {
        user: {
          name: user.fullName,
          currentWallet: user.wallet,
          storedEarnings: user.earnings,
        },
        stepByStep: {
          "1_earnings_from_consultations": totalEarningsFromConsultations,
          "2_manual_deposits": totalDeposits,
          "3_total_income": totalIncome,
          "4_spent_on_consultations": totalSpentOnConsultations,
          "5_withdrawn_processed": totalWithdrawnProcessed,
          "6_total_outflow": totalOutflow,
          "7_expected_wallet": expectedWallet,
          "8_actual_wallet": user.wallet,
          "9_difference": user.wallet - expectedWallet,
        },
        counts: {
          providerConsultations: providerConsultations.length,
          clientConsultations: clientConsultations.length,
          totalTransactions: allTransactions.length,
          deposits: deposits.length,
          withdrawals: withdrawals.length,
        },
        recentTransactions: allTransactions.slice(0, 10),
        providerConsultations: providerConsultations.slice(0, 5),
        clientConsultations: clientConsultations.slice(0, 5),
        withdrawals: withdrawals,
      },
    });
  } catch (error) {
    console.error("Debug error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Check if user can afford consultation
const checkConsultationAffordability = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { providerId, consultationType, estimatedDuration } = req.body;

    // Get user wallet balance
    const user = await User.findById(userId).select("wallet");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get provider rates
    const provider = await User.findById(providerId).select("rates");
    if (!provider) {
      return res.status(404).json({ message: "Provider not found" });
    }

    // Calculate estimated cost
    const rate =
      provider.rates?.audioVideo || provider.rates?.[consultationType] || 0;
    const estimatedCost = (estimatedDuration || 30) * rate; // Default 30 minutes

    // Calculate maximum talk time with current balance
    const maxTalkTime = rate > 0 ? Math.floor(user.wallet / rate) : 0;

    const canAfford = user.wallet >= estimatedCost;

    res.json({
      success: true,
      data: {
        walletBalance: user.wallet,
        rate,
        estimatedCost,
        canAfford,
        maxTalkTime,
        estimatedDuration: estimatedDuration || 30,
      },
    });
  } catch (error) {
    logger.error("Error checking consultation affordability:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get withdrawal limits (75% policy for providers, 100% for guests)
const getWithdrawalLimits = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const isGuest = req.user.isGuest;

    let user;
    if (isGuest) {
      user = await Guest.findById(userId).select("wallet");
    } else {
      user = await User.findById(userId).select("wallet");
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Calculate withdrawal limits
    const currentBalance = user.wallet || 0;
    let maxWithdrawable,
      minimumBalance,
      withdrawalPercentage,
      retentionPercentage,
      policy;

    if (isGuest) {
      // Guests can withdraw 100% of their balance
      maxWithdrawable = currentBalance;
      minimumBalance = 0;
      withdrawalPercentage = 100;
      retentionPercentage = 0;
      policy = "Guests can withdraw their full wallet balance.";
    } else {
      // Providers can only withdraw 75% (25% retention policy)
      maxWithdrawable = Math.floor(currentBalance * 0.75);
      minimumBalance = currentBalance - maxWithdrawable;
      withdrawalPercentage = 75;
      retentionPercentage = 25;
      policy =
        "Service providers can withdraw up to 75% of wallet balance. 25% must remain as minimum balance.";
    }

    console.log("💰 WITHDRAWAL LIMITS:", {
      userId,
      userType: isGuest ? "Guest" : "Provider",
      currentBalance,
      maxWithdrawable,
      minimumBalance,
      policy,
    });

    res.json({
      success: true,
      data: {
        currentBalance,
        maxWithdrawable,
        minimumBalance,
        withdrawalPercentage,
        retentionPercentage,
        policy,
        userType: isGuest ? "Guest" : "Provider",
      },
    });
  } catch (error) {
    console.error("❌ ERROR getting withdrawal limits:", error);
    logger.error("Error getting withdrawal limits:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    });
  }
};

// Add test earnings (for testing purposes)
const addTestEarnings = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { amount = 500 } = req.body;

    console.log(
      "🧪 BACKEND: Adding test earnings for user:",
      userId,
      "amount:",
      amount
    );

    // Add test earnings
    const transaction = await addEarnings(
      userId,
      null, // No consultation ID for test
      amount,
      "Test Earnings - Video Consultation",
      {
        clientName: "Test Client",
        consultationType: "video",
        duration: 30,
        rate: amount / 30,
      }
    );

    console.log("✅ BACKEND: Test earnings added:", transaction);

    res.json({
      success: true,
      message: "Test earnings added successfully",
      data: transaction,
    });
  } catch (error) {
    logger.error("Error adding test earnings:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  getEarningsOverview,
  getTransactionHistory,
  getWithdrawalHistory,
  requestWithdrawal,
  addEarnings,
  getEarningsChart,
  debugUserEarnings,
  addTestEarnings,
  fixUserWallet,
  addMoneyToWallet,
  updateWalletBalance,
  checkConsultationAffordability,
  debugWalletCalculations,
  getWithdrawalLimits,
};
