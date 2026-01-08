/**
 * FIX FREE MINUTE BILLING BUG
 *
 * Issue: Free minute is not being applied during billing
 * The billing logic is not checking billingStartsAt to implement free minute
 */

const fs = require("fs");
const path = require("path");

const filePath = path.join(
  __dirname,
  "src/controllers/realTimeBilling.controller.js"
);

// Read the current file
let content = fs.readFileSync(filePath, "utf8");

// Find the billing logic section and add free minute check
const oldBillingLogic = `    // Process billing - ROUND UP APPROACH (any usage = full minute charge)
    const elapsedMinutesRoundedUp = Math.ceil(elapsedSeconds / 60); // Round UP to next minute
    const minutesToBill = elapsedMinutesRoundedUp - (consultation.duration || 0);

    if (minutesToBill > 0) {
      const amountToBill = minutesToBill * ratePerMinute;

      console.log("💰 ROUND UP BILLING (Any usage = full minute charge):", {
        elapsedSeconds,
        elapsedMinutesRoundedUp,
        minutesToBill,
        amountToBill,
        currentWallet,
        newBalance: currentWallet - amountToBill,
        approach: "10 seconds = ₹1, 1min 10sec = ₹2, etc."
      });

      // Deduct money from CLIENT
      clientUser.wallet -= amountToBill;`;

const newBillingLogic = `    // CRITICAL FIX: Check if billing should start (free minute logic)
    const currentTime = new Date();
    const shouldStartBilling = !consultation.billingStartsAt || currentTime >= consultation.billingStartsAt;
    
    console.log("🆓 FREE MINUTE CHECK:", {
      isFirstMinuteFree: consultation.isFirstMinuteFree,
      billingStartsAt: consultation.billingStartsAt,
      currentTime: currentTime,
      shouldStartBilling: shouldStartBilling,
      elapsedSeconds: elapsedSeconds
    });

    // If billing hasn't started yet (first minute free), don't charge
    if (!shouldStartBilling) {
      console.log("🆓 FIRST MINUTE FREE - No billing yet");
      
      return res.json({
        success: true,
        data: {
          charged: 0,
          remainingBalance: currentWallet,
          canContinue: true,
          remainingSeconds: 999999, // Plenty of time during free minute
          duration: 0,
          totalAmount: 0,
          freeMinuteActive: true,
          message: "First minute is free!"
        },
      });
    }

    // Calculate billable time (subtract free minute if applicable)
    let billableSeconds = elapsedSeconds;
    if (consultation.isFirstMinuteFree && !consultation.freeMinuteUsed) {
      billableSeconds = Math.max(0, elapsedSeconds - 60); // Subtract 60 seconds for free minute
      
      // Mark free minute as used
      consultation.freeMinuteUsed = true;
      
      console.log("🆓 APPLYING FREE MINUTE:", {
        totalElapsedSeconds: elapsedSeconds,
        billableSeconds: billableSeconds,
        freeMinuteDeducted: 60
      });
    }

    // Process billing - ROUND UP APPROACH (any usage = full minute charge)
    const billableMinutesRoundedUp = Math.ceil(billableSeconds / 60); // Round UP to next minute
    const minutesToBill = billableMinutesRoundedUp - (consultation.duration || 0);

    if (minutesToBill > 0) {
      const amountToBill = minutesToBill * ratePerMinute;

      console.log("💰 ROUND UP BILLING (Any usage = full minute charge):", {
        elapsedSeconds,
        billableSeconds,
        billableMinutesRoundedUp,
        minutesToBill,
        amountToBill,
        currentWallet,
        newBalance: currentWallet - amountToBill,
        approach: "10 seconds = ₹1, 1min 10sec = ₹2, etc.",
        freeMinuteApplied: consultation.isFirstMinuteFree
      });

      // Deduct money from CLIENT
      clientUser.wallet -= amountToBill;`;

// Apply the fix
if (content.includes(oldBillingLogic)) {
  content = content.replace(oldBillingLogic, newBillingLogic);

  // Write the updated content back to the file
  fs.writeFileSync(filePath, content, "utf8");

  console.log("✅ FREE MINUTE BILLING FIX APPLIED");
  console.log("─".repeat(50));
  console.log("Fixed issues:");
  console.log("1. ✅ Added billingStartsAt check for free minute");
  console.log(
    "2. ✅ Added billable seconds calculation (subtract free minute)"
  );
  console.log("3. ✅ Added freeMinuteUsed flag update");
  console.log("4. ✅ Added proper logging for free minute logic");
  console.log("");
  console.log("Now first minute will be truly FREE for new users!");
} else {
  console.log("❌ Could not find the billing logic to replace");
  console.log("The code may have been modified already");
}
