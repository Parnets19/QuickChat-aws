const axios = require("axios");

/**
 * TEST: Direct API call to /billing/end to see if it works
 */

async function testEndConsultationAPI() {
  console.log("🧪 TESTING END CONSULTATION API");
  console.log("=".repeat(50));

  try {
    // Use the consultation we created in our test
    const consultationId = "695d0470742c8aef03d39f9a"; // From our successful test
    const API_BASE = "http://localhost:5001/api";

    // We need a valid token - let's get Nandu's token
    console.log("🔑 Getting authentication token...");

    const loginResponse = await axios.post(`${API_BASE}/auth/login`, {
      email: "nandu@example.com",
      password: "password123",
    });

    if (!loginResponse.data.success) {
      console.log("❌ Login failed");
      return;
    }

    const token = loginResponse.data.token;
    console.log("✅ Login successful");

    // Now test the end consultation API
    console.log(`\n🛑 Testing /billing/end API...`);
    console.log(`   Consultation ID: ${consultationId}`);

    const endResponse = await axios.post(
      `${API_BASE}/billing/end`,
      { consultationId },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ API CALL SUCCESSFUL:");
    console.log("   Status:", endResponse.status);
    console.log("   Response:", JSON.stringify(endResponse.data, null, 2));
  } catch (error) {
    console.error("❌ API CALL FAILED:");
    console.error("   Status:", error.response?.status);
    console.error("   Status Text:", error.response?.statusText);
    console.error(
      "   Error Data:",
      JSON.stringify(error.response?.data, null, 2)
    );
    console.error("   Error Message:", error.message);

    if (error.response?.status === 404) {
      console.log("\n🔍 POSSIBLE CAUSES:");
      console.log("   1. Route not properly registered");
      console.log("   2. Server not running");
      console.log("   3. Wrong API base URL");
    } else if (error.response?.status === 401) {
      console.log("\n🔍 POSSIBLE CAUSES:");
      console.log("   1. Invalid or expired token");
      console.log("   2. Authentication middleware issue");
    } else if (error.response?.status === 500) {
      console.log("\n🔍 POSSIBLE CAUSES:");
      console.log("   1. Database connection issue");
      console.log("   2. Error in endConsultation function");
      console.log("   3. Missing required data");
    }
  }
}

testEndConsultationAPI();
