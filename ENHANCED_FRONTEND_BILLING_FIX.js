/**
 * ENHANCED FRONTEND BILLING FIX
 *
 * This file contains the enhanced endBillingConsultation function
 * that prevents ghost billing by implementing:
 * 1. Multiple retry attempts with exponential backoff
 * 2. Timeout handling
 * 3. Emergency fallback methods
 * 4. Proper error logging
 * 5. Client-side validation before backend calls
 */

// Enhanced endBillingConsultation function for ConsultationRoom.jsx
const enhancedEndBillingConsultation = `
  const endBillingConsultation = async () => {
    try {
      if (!billingConsultationId) {
        console.log("❌ No billing consultation ID to end");
        return;
      }

      console.log("🛑 Ending billing consultation:", billingConsultationId);

      // Stop billing timer IMMEDIATELY - don't wait for API
      if (billingTimerRef.current) {
        clearInterval(billingTimerRef.current);
        billingTimerRef.current = null;
        console.log("✅ IMMEDIATE: Billing timer stopped");
      }

      // Stop wallet balance monitoring IMMEDIATELY
      stopWalletBalanceMonitoring();

      setBillingActive(false);

      // 🚨 ENHANCED FIX: Multiple retry attempts with exponential backoff
      let endSuccess = false;
      let retryCount = 0;
      const maxRetries = 5; // Increased from 3 to 5
      const baseDelay = 2000; // Base delay of 2 seconds

      while (!endSuccess && retryCount < maxRetries) {
        try {
          console.log(
            \`🔄 Attempt \${retryCount + 1}/\${maxRetries} to end billing consultation...\`
          );

          // Calculate exponential backoff delay
          const delay = retryCount > 0 ? baseDelay * Math.pow(2, retryCount - 1) : 0;
          if (delay > 0) {
            console.log(\`⏳ Waiting \${delay}ms before retry...\`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }

          // 🚨 CRITICAL: Validate consultation state before ending
          console.log("🔍 Validating consultation state before ending...");
          
          // Check if consultation is still ongoing in backend
          const statusResponse = await Promise.race([
            realTimeBillingService.getConsultationStatus(billingConsultationId),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Status check timeout")), 5000)
            ),
          ]);

          if (statusResponse.success && statusResponse.data.status !== "ongoing") {
            console.log(\`✅ Consultation already ended with status: \${statusResponse.data.status}\`);
            endSuccess = true;
            
            // Update local state with backend data
            const finalAmount = statusResponse.data.totalAmount || 0;
            const finalDuration = statusResponse.data.duration || 0;
            
            setTotalBilled(finalAmount);
            setMinutesBilled(finalDuration);
            
            console.log("💰 CONSULTATION ALREADY ENDED:", {
              duration: finalDuration,
              amount: finalAmount,
              status: statusResponse.data.status
            });
            
            // Show rating modal for paid consultations
            if (finalAmount > 0) {
              setTimeout(() => {
                setIsRatingModalActive(true);
                setShowRatingModal(true);
                console.log("⭐ Rating modal activated for completed consultation");
              }, 1500);
            }
            
            break; // Exit retry loop
          }

          // Attempt to end the consultation with timeout
          const response = await Promise.race([
            realTimeBillingService.endConsultation(billingConsultationId),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("API timeout")), 15000) // Increased timeout to 15 seconds
            ),
          ]);

          if (response.success) {
            console.log(
              "✅ Billing consultation ended successfully:",
              response.data
            );
            endSuccess = true;

            // Update final amounts
            const finalAmount = response.data.totalAmount || 0;
            const finalDuration = response.data.duration || 0;

            setTotalBilled(finalAmount);
            setMinutesBilled(finalDuration);

            // Show precise billing information
            const durationText =
              finalDuration < 1
                ? \`\${Math.round(finalDuration * 60)} seconds\`
                : \`\${finalDuration.toFixed(2)} minutes\`;

            showNotification(
              \`Call ended. Duration: \${durationText}, Charged: ₹\${finalAmount.toFixed(2)}\`,
              "info"
            );

            console.log("💰 FINAL BILLING:", {
              duration: finalDuration,
              durationText,
              amount: finalAmount,
              billingStoppedAt: new Date().toISOString(),
            });

            // 🎯 RATING MODAL FIX: Show rating modal for paid consultations
            if (finalAmount > 0) {
              console.log("⭐ Paid consultation completed - showing rating modal");

              setTimeout(() => {
                setIsRatingModalActive(true);
                setShowRatingModal(true);
                console.log("⭐ Rating modal activated");
              }, 1500);
            } else {
              console.log("🆓 Free consultation - no rating modal needed");

              setTimeout(() => {
                if (!isRatingModalActive) {
                  console.log("🔙 Navigating back after free consultation");
                  safeNavigate(-1);
                }
              }, 3000);
            }
          } else {
            throw new Error("Backend returned failure response");
          }
        } catch (error) {
          retryCount++;
          console.error(\`❌ Attempt \${retryCount} failed:\`, error.message);

          // 🚨 CRITICAL: Log detailed error information for monitoring
          console.error("🚨 DETAILED ERROR INFO:", {
            consultationId: billingConsultationId,
            attempt: retryCount,
            maxRetries,
            errorType: error.name,
            errorMessage: error.message,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            connectionType: navigator.connection?.effectiveType || "unknown",
            onLine: navigator.onLine
          });

          if (retryCount < maxRetries) {
            const nextDelay = baseDelay * Math.pow(2, retryCount - 1);
            console.log(\`🔄 Retrying in \${nextDelay}ms... (\${maxRetries - retryCount} attempts left)\`);
          }
        }
      }

      // 🚨 EMERGENCY: If all retries failed, use multiple fallback methods
      if (!endSuccess) {
        console.error("🚨 CRITICAL: All attempts to end billing consultation failed!");
        
        // 🚨 FALLBACK 1: Try regular consultation API
        console.log("🚨 FALLBACK 1: Attempting regular consultation end...");
        try {
          const fallbackResponse = await Promise.race([
            consultationService.endConsultation(billingConsultationId),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Fallback timeout")), 10000)
            ),
          ]);
          
          console.log("✅ FALLBACK 1: Regular consultation end succeeded:", fallbackResponse);
          endSuccess = true;
          
          showNotification(
            "Call ended (fallback mode). Please check your billing in My Consultations.",
            "warning"
          );
        } catch (fallbackError) {
          console.error("❌ FALLBACK 1: Regular consultation end failed:", fallbackError);
        }
      }

      // 🚨 FALLBACK 2: If still failed, try direct status update
      if (!endSuccess) {
        console.log("🚨 FALLBACK 2: Attempting direct status update...");
        try {
          // This would be a new API endpoint for emergency consultation ending
          const emergencyResponse = await Promise.race([
            api.post(\`/api/consultations/\${billingConsultationId}/emergency-end\`, {
              reason: "frontend_timeout",
              timestamp: new Date().toISOString(),
              userAgent: navigator.userAgent
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Emergency timeout")), 8000)
            ),
          ]);
          
          console.log("✅ FALLBACK 2: Emergency end succeeded:", emergencyResponse.data);
          endSuccess = true;
          
          showNotification(
            "Call ended (emergency mode). Billing has been stopped.",
            "info"
          );
        } catch (emergencyError) {
          console.error("❌ FALLBACK 2: Emergency end failed:", emergencyError);
        }
      }

      // 🚨 FINAL FALLBACK: If everything failed, at least prevent local billing
      if (!endSuccess) {
        console.error("🚨 ULTIMATE FAILURE: All fallback methods failed!");
        
        // 🚨 Log critical error for immediate attention
        console.error("🚨 CRITICAL BILLING SYNC FAILURE:", {
          billingConsultationId,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          connectionType: navigator.connection?.effectiveType || "unknown",
          onLine: navigator.onLine,
          retryAttempts: retryCount,
          error: "All end consultation methods failed"
        });

        // 🚨 Send error report to monitoring service (if available)
        try {
          if (window.errorReporting) {
            window.errorReporting.reportCriticalError({
              type: "ghost_billing_risk",
              consultationId: billingConsultationId,
              userId: user?.id,
              timestamp: new Date().toISOString(),
              details: "Frontend unable to end consultation - ghost billing risk"
            });
          }
        } catch (reportError) {
          console.error("Failed to send error report:", reportError);
        }

        // 🚨 Show critical error to user
        showNotification(
          "⚠️ CRITICAL: Unable to confirm call end with server. Please contact support immediately to verify billing.",
          "error"
        );

        // 🚨 Force local state cleanup to prevent continued billing
        setBillingActive(false);
        setBillingConsultationId(null);
        setTotalBilled(0);
        setMinutesBilled(0);
        
        console.log("🚨 FORCED LOCAL CLEANUP: Billing state reset to prevent ghost billing");
      }

    } catch (error) {
      console.error("❌ CRITICAL ERROR in endBillingConsultation:", error);

      // 🚨 EMERGENCY: Even if everything fails, ensure billing is stopped locally
      if (billingTimerRef.current) {
        clearInterval(billingTimerRef.current);
        billingTimerRef.current = null;
        console.log("🚨 EMERGENCY: Force stopped billing timer");
      }

      setBillingActive(false);
      stopWalletBalanceMonitoring();

      showNotification(
        "⚠️ Call ended with errors. Please check your billing in My Consultations and contact support if needed.",
        "error"
      );
    }
  };
`;

console.log("📋 ENHANCED FRONTEND BILLING FIX");
console.log("=".repeat(60));
console.log("This enhanced endBillingConsultation function includes:");
console.log("✅ Multiple retry attempts (5 instead of 3)");
console.log("✅ Exponential backoff delays");
console.log("✅ Consultation state validation before ending");
console.log("✅ Multiple fallback methods");
console.log("✅ Detailed error logging");
console.log("✅ Critical error reporting");
console.log("✅ Force local cleanup to prevent ghost billing");
console.log("=".repeat(60));
console.log(
  "Copy this function to replace the existing one in ConsultationRoom.jsx"
);

module.exports = { enhancedEndBillingConsultation };
