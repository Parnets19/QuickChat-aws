
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
            console.log(`🚨 SERVER MONITOR: No recent billing for consultation ${consultation._id}`);
            console.log(`   Duration: ${callDurationMinutes.toFixed(2)} minutes`);
            console.log(`   Client: ${consultation.user.fullName || "Unknown"}`);
            console.log(`   Provider: ${consultation.provider.fullName}`);
            
            // Force end the consultation
            await endConsultationDueToInsufficientFunds(consultation._id);
            
            console.log(`✅ SERVER MONITOR: Force ended stuck consultation`);
          }
        }
        
        // Check wallet balance
        const userWallet = consultation.user.wallet || 0;
        const ratePerMinute = consultation.rate;
        
        if (userWallet < ratePerMinute) {
          console.log(`🚨 SERVER MONITOR: Insufficient balance detected`);
          console.log(`   User: ${consultation.user.fullName || "Unknown"}`);
          console.log(`   Balance: ₹${userWallet}`);
          console.log(`   Required: ₹${ratePerMinute}`);
          
          // Force end due to insufficient funds
          await endConsultationDueToInsufficientFunds(consultation._id);
          
          console.log(`✅ SERVER MONITOR: Auto-terminated due to insufficient funds`);
        }
      }
      
    } catch (error) {
      console.error("❌ Server-side monitoring error:", error);
    }
  }, 30000); // Check every 30 seconds
};

// Start monitoring when server starts
startServerSideWalletMonitoring();
