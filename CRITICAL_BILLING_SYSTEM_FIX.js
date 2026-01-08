const fs = require("fs");
const path = require("path");

/**
 * CRITICAL FIX: Real-time billing system failure
 *
 * Issues identified:
 * 1. Frontend billing timer stops working
 * 2. No wallet protection during calls
 * 3. Calls continue indefinitely without billing
 * 4. No server-side monitoring
 */

console.log("🚨 CRITICAL BILLING SYSTEM FIX");
console.log("=".repeat(50));

// 1. Fix frontend billing timer reliability
const frontendBillingFix = `
// ENHANCED BILLING TIMER WITH MULTIPLE SAFEGUARDS
const startBillingTimer = () => {
  console.log("⏰ Starting enhanced billing timer with safeguards");
  
  // Clear any existing timer
  if (billingTimerRef.current) {
    clearInterval(billingTimerRef.current);
  }
  
  // Primary timer - every 60 seconds
  billingTimerRef.current = setInterval(async () => {
    try {
      console.log("⏰ BILLING TIMER TICK - Processing minute billing");
      
      if (!billingActive || !billingConsultationId) {
        console.log("❌ Billing not active - stopping timer");
        clearInterval(billingTimerRef.current);
        return;
      }
      
      // Call billing API with timeout and retry
      await processBillingWithRetry();
      
    } catch (error) {
      console.error("❌ CRITICAL: Billing timer error:", error);
      
      // Emergency: End consultation if billing fails repeatedly
      billingErrorCount++;
      if (billingErrorCount >= 3) {
        console.error("🚨 EMERGENCY: Too many billing failures - ending consultation");
        await endBillingConsultation();
      }
    }
  }, 60000); // 60 seconds
  
  // Backup timer - every 30 seconds (checks wallet balance)
  backupTimerRef.current = setInterval(async () => {
    try {
      if (!billingActive || !billingConsultationId) return;
      
      console.log("🔍 BACKUP TIMER: Checking wallet balance");
      const walletResponse = await realTimeBillingService.getWalletBalance();
      
      if (walletResponse.success) {
        const balance = walletResponse.data.walletBalance;
        console.log(\`💰 Current balance: ₹\${balance}\`);
        
        // If balance is insufficient for next minute, end call immediately
        if (balance < currentRate) {
          console.log("🚨 INSUFFICIENT BALANCE DETECTED - Emergency call end");
          await endBillingConsultation();
        }
      }
    } catch (error) {
      console.error("❌ Backup timer error:", error);
    }
  }, 30000); // 30 seconds
  
  console.log("✅ Enhanced billing timer started with primary and backup monitoring");
};

const processBillingWithRetry = async () => {
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      console.log(\`🔄 Billing attempt \${retryCount + 1}/\${maxRetries}\`);
      
      const response = await Promise.race([
        realTimeBillingService.processBilling(billingConsultationId),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Billing timeout")), 10000)
        )
      ]);
      
      if (response.success) {
        console.log("✅ Billing processed successfully");
        billingErrorCount = 0; // Reset error count on success
        
        // Check if call should continue
        if (response.data && !response.data.canContinue) {
          console.log("🛑 Billing indicates call should end");
          await endBillingConsultation();
        }
        
        return response;
      } else {
        throw new Error("Billing API returned failure");
      }
      
    } catch (error) {
      retryCount++;
      console.error(\`❌ Billing attempt \${retryCount} failed:\`, error.message);
      
      if (retryCount < maxRetries) {
        console.log("🔄 Retrying billing in 2 seconds...");
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  
  throw new Error("All billing attempts failed");
};
`;

// 2. Add server-side wallet monitoring
const serverSideMonitoringFix = `
/**
 * SERVER-SIDE WALLET MONITORING
 * Runs independently to catch frontend failures
 */
const startServerSideWalletMonitoring = () => {
  console.log("🖥️ Starting server-side wallet monitoring");
  
  setInterval(async () => {
    try {
      // Find all ongoing consultations
      const ongoingConsultations = await Consultation.find({
        status: "ongoing",
        billingStarted: true,
        bothSidesAcceptedAt: { $exists: true }
      }).populate("user", "wallet").populate("provider", "fullName");
      
      for (const consultation of ongoingConsultations) {
        const now = new Date();
        const callDurationMinutes = (now - consultation.bothSidesAcceptedAt) / (1000 * 60);
        
        // Check if call has been running too long without billing
        if (callDurationMinutes > 2) { // More than 2 minutes
          const recentTransactions = await Transaction.find({
            user: consultation.user._id,
            consultationId: consultation._id,
            createdAt: { $gte: new Date(now - 2 * 60 * 1000) } // Last 2 minutes
          });
          
          if (recentTransactions.length === 0) {
            console.log(\`🚨 SERVER MONITOR: No recent billing for consultation \${consultation._id}\`);
            console.log(\`   Duration: \${callDurationMinutes.toFixed(2)} minutes\`);
            console.log(\`   Client: \${consultation.user.fullName || "Unknown"}\`);
            console.log(\`   Provider: \${consultation.provider.fullName}\`);
            
            // Force end the consultation
            await endConsultationDueToInsufficientFunds(consultation._id);
            
            console.log(\`✅ SERVER MONITOR: Force ended stuck consultation\`);
          }
        }
        
        // Check wallet balance
        const userWallet = consultation.user.wallet || 0;
        const ratePerMinute = consultation.rate;
        
        if (userWallet < ratePerMinute) {
          console.log(\`🚨 SERVER MONITOR: Insufficient balance detected\`);
          console.log(\`   User: \${consultation.user.fullName || "Unknown"}\`);
          console.log(\`   Balance: ₹\${userWallet}\`);
          console.log(\`   Required: ₹\${ratePerMinute}\`);
          
          // Force end due to insufficient funds
          await endConsultationDueToInsufficientFunds(consultation._id);
          
          console.log(\`✅ SERVER MONITOR: Auto-terminated due to insufficient funds\`);
        }
      }
      
    } catch (error) {
      console.error("❌ Server-side monitoring error:", error);
    }
  }, 30000); // Check every 30 seconds
};

// Start monitoring when server starts
startServerSideWalletMonitoring();
`;

// 3. Enhanced error handling
const errorHandlingFix = `
/**
 * ENHANCED ERROR HANDLING FOR BILLING
 */
const handleBillingError = async (error, consultationId, context) => {
  console.error(\`❌ BILLING ERROR in \${context}:\`, error);
  
  // Log critical error for monitoring
  logger.error("CRITICAL_BILLING_ERROR", {
    consultationId,
    context,
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    userAgent: req?.headers?.['user-agent']
  });
  
  // Increment error count
  billingErrorCounts[consultationId] = (billingErrorCounts[consultationId] || 0) + 1;
  
  // If too many errors, force end consultation
  if (billingErrorCounts[consultationId] >= 3) {
    console.error(\`🚨 CRITICAL: Too many billing errors for \${consultationId} - force ending\`);
    
    try {
      await endConsultationDueToInsufficientFunds(consultationId);
      delete billingErrorCounts[consultationId];
    } catch (endError) {
      console.error("❌ Failed to force end consultation:", endError);
    }
  }
  
  // Emit error to frontend
  if (io) {
    io.to(\`billing:\${consultationId}\`).emit("billing:error", {
      message: "Billing system error - call may be terminated",
      errorCount: billingErrorCounts[consultationId],
      timestamp: new Date()
    });
  }
};
`;

console.log("📝 FIXES PREPARED:");
console.log("1. ✅ Enhanced frontend billing timer with backup monitoring");
console.log("2. ✅ Server-side wallet monitoring system");
console.log("3. ✅ Improved error handling and recovery");
console.log("4. ✅ Multiple safeguards against billing failures");

console.log("\n🔧 IMPLEMENTATION STEPS:");
console.log("1. Update ConsultationRoom.jsx with enhanced billing timer");
console.log("2. Add server-side monitoring to realTimeBilling.controller.js");
console.log("3. Implement error handling improvements");
console.log("4. Add automatic cleanup for stuck consultations");

console.log("\n⚠️ CRITICAL PRIORITY:");
console.log("This fix prevents users from getting unlimited free calls");
console.log("and ensures wallet protection works correctly.");

// Write fixes to files for implementation
fs.writeFileSync(
  path.join(__dirname, "FRONTEND_BILLING_TIMER_FIX.js"),
  frontendBillingFix
);

fs.writeFileSync(
  path.join(__dirname, "SERVER_SIDE_MONITORING_FIX.js"),
  serverSideMonitoringFix
);

fs.writeFileSync(
  path.join(__dirname, "BILLING_ERROR_HANDLING_FIX.js"),
  errorHandlingFix
);

console.log("\n✅ Fix files created:");
console.log("- FRONTEND_BILLING_TIMER_FIX.js");
console.log("- SERVER_SIDE_MONITORING_FIX.js");
console.log("- BILLING_ERROR_HANDLING_FIX.js");

console.log("\n🎯 NEXT STEPS:");
console.log("1. Apply these fixes to the actual code files");
console.log("2. Test the enhanced billing system");
console.log("3. Monitor for any remaining issues");
console.log("4. Implement additional safeguards as needed");
