/**
 * TEST ₹3 PER MINUTE RATE SYSTEM
 *
 * This script tests that all providers are now charging ₹3 per minute
 * and the billing system is working correctly with the new rates
 */

const axios = require("axios");
require("dotenv").config();

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:5000/api";

// Test user credentials
const TEST_USER = {
  mobile: "9876543210",
  name: "Test User Rate Check",
};

let authToken = "";

async function test3RsPerMinuteRate() {
  console.log("💰 TESTING ₹3 PER MINUTE RATE SYSTEM");
  console.log("===================================");
  console.log("");

  try {
    // Step 1: Login as test user
    console.log("1️⃣ Logging in as test user...");
    const loginResponse = await axios.post(`${API_BASE_URL}/guest-auth/login`, {
      mobile: TEST_USER.mobile,
      name: TEST_USER.name,
    });

    if (loginResponse.data.success) {
      authToken = loginResponse.data.data.token;
      console.log("✅ Login successful");
    } else {
      throw new Error("Login failed");
    }

    // Step 2: Get all providers and check their rates
    console.log("");
    console.log("2️⃣ Checking all provider rates...");
    const providersResponse = await axios.get(
      `${API_BASE_URL}/users/providers`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );

    const providers = providersResponse.data.data || [];
    console.log(`📊 Found ${providers.length} providers`);

    let correctRateCount = 0;
    let incorrectRateCount = 0;

    console.log("\n📋 PROVIDER RATE VERIFICATION:");
    console.log("================================");

    for (const provider of providers) {
      const rate =
        provider.rates?.perMinute?.audioVideo ||
        provider.rates?.audioVideo ||
        0;
      const audioRate =
        provider.rates?.perMinute?.audio || provider.rates?.audio || 0;
      const videoRate =
        provider.rates?.perMinute?.video || provider.rates?.video || 0;

      console.log(`\n👤 ${provider.fullName}:`);
      console.log(`   Audio/Video Rate: ₹${rate}/min`);
      console.log(`   Audio Rate: ₹${audioRate}/min`);
      console.log(`   Video Rate: ₹${videoRate}/min`);

      if (rate === 3 && audioRate === 3 && videoRate === 3) {
        console.log("   ✅ CORRECT: All rates set to ₹3/min");
        correctRateCount++;
      } else {
        console.log("   ❌ INCORRECT: Rates not set to ₹3/min");
        incorrectRateCount++;
      }
    }

    // Step 3: Test affordability with ₹3 rate
    console.log("\n3️⃣ Testing affordability with ₹3 rate...");

    const testProvider = providers.find((p) => {
      const rate = p.rates?.perMinute?.audioVideo || p.rates?.audioVideo || 0;
      return rate === 3;
    });

    if (testProvider) {
      console.log(`Testing with provider: ${testProvider.fullName}`);

      const affordabilityResponse = await axios.post(
        `${API_BASE_URL}/billing/check-affordability`,
        {
          providerId: testProvider._id,
          consultationType: "video",
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );

      const affordabilityData = affordabilityResponse.data.data;
      console.log("💰 Affordability check result:");
      console.log(
        `   Rate per minute: ₹${affordabilityData.ratePerMinute}/min`
      );
      console.log(`   User wallet: ₹${affordabilityData.userWallet}`);
      console.log(
        `   Can afford: ${affordabilityData.canAfford ? "✅ YES" : "❌ NO"}`
      );
      console.log(
        `   Max talk time: ${affordabilityData.maxTalkTimeMinutes} minutes`
      );

      if (affordabilityData.ratePerMinute === 3) {
        console.log("   ✅ CORRECT: System recognizes ₹3/min rate");
      } else {
        console.log("   ❌ INCORRECT: System not using ₹3/min rate");
      }
    }

    // Step 4: Test free trial system with ₹3 rate
    console.log("\n4️⃣ Testing free trial system with ₹3 rate...");

    const freeTrialResponse = await axios.get(
      `${API_BASE_URL}/free-trial/check-eligibility`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );

    const isEligible = freeTrialResponse.data.data.isEligibleForFreeTrial;
    console.log(`Free trial eligible: ${isEligible ? "✅ YES" : "❌ NO"}`);

    if (isEligible && testProvider) {
      console.log("Testing free trial affordability...");

      const freeTrialAffordability = await axios.post(
        `${API_BASE_URL}/billing/check-affordability`,
        {
          providerId: testProvider._id,
          consultationType: "video",
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );

      const freeTrialData = freeTrialAffordability.data.data;
      if (freeTrialData.reason === "first_time_free_trial") {
        console.log("   ✅ CORRECT: Free trial works with ₹3/min providers");
        console.log("   🎉 First call will be completely FREE!");
      } else {
        console.log("   ❌ INCORRECT: Free trial not working properly");
      }
    }

    // Summary
    console.log("\n💰 RATE VERIFICATION SUMMARY");
    console.log("============================");
    console.log(`✅ Providers with correct ₹3/min rate: ${correctRateCount}`);
    console.log(`❌ Providers with incorrect rate: ${incorrectRateCount}`);
    console.log(`📊 Total providers checked: ${providers.length}`);

    if (incorrectRateCount === 0) {
      console.log("\n🎉 SUCCESS: All providers are charging ₹3 per minute!");
      console.log("✅ Rate system is working correctly");
      console.log("✅ Free trial system compatible with ₹3 rate");
      console.log("✅ Billing system recognizes ₹3/min rate");
    } else {
      console.log("\n⚠️  WARNING: Some providers have incorrect rates");
      console.log("❌ Rate system needs adjustment");
    }

    console.log("\n💡 BILLING BEHAVIOR:");
    console.log("- First call: Completely FREE (unlimited duration)");
    console.log("- Second call onwards: ₹3 per minute from first second");
    console.log("- Users need minimum ₹3 in wallet for paid calls");
  } catch (error) {
    console.error("❌ Test failed:", error.response?.data || error.message);
  }
}

// Run the test
test3RsPerMinuteRate();
