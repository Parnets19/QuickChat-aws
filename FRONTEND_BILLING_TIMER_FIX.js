
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
        console.log(`💰 Current balance: ₹${balance}`);
        
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
      console.log(`🔄 Billing attempt ${retryCount + 1}/${maxRetries}`);
      
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
      console.error(`❌ Billing attempt ${retryCount} failed:`, error.message);
      
      if (retryCount < maxRetries) {
        console.log("🔄 Retrying billing in 2 seconds...");
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  
  throw new Error("All billing attempts failed");
};
