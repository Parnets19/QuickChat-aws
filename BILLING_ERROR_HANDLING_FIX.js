
/**
 * ENHANCED ERROR HANDLING FOR BILLING
 */
const handleBillingError = async (error, consultationId, context) => {
  console.error(`❌ BILLING ERROR in ${context}:`, error);
  
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
    console.error(`🚨 CRITICAL: Too many billing errors for ${consultationId} - force ending`);
    
    try {
      await endConsultationDueToInsufficientFunds(consultationId);
      delete billingErrorCounts[consultationId];
    } catch (endError) {
      console.error("❌ Failed to force end consultation:", endError);
    }
  }
  
  // Emit error to frontend
  if (io) {
    io.to(`billing:${consultationId}`).emit("billing:error", {
      message: "Billing system error - call may be terminated",
      errorCount: billingErrorCounts[consultationId],
      timestamp: new Date()
    });
  }
};
