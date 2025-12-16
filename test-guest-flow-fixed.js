#!/usr/bin/env node

/**
 * Simple Guest User Flow Test - Fixed Version
 * Tests the basic guest user consultation creation
 */

const axios = require('axios');

// Configuration
const API_BASE_URL = 'http://localhost:5001/api';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function testGuestUserFlow() {
  try {
    log('🧪 Testing Guest User Consultation Flow', colors.bright);
    log('=' .repeat(50), colors.cyan);
    
    // Generate unique mobile number for testing
    const testMobile = `987654${Math.floor(1000 + Math.random() * 9000)}`;
    
    // Step 1: Send OTP for guest user
    log('\n1. Sending OTP for guest user...', colors.cyan);
    log(`   Using mobile: ${testMobile}`, colors.yellow);
    const otpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
      mobile: testMobile,
      purpose: 'guest'
    });
    
    if (!otpResponse.data.success) {
      log('❌ OTP send failed', colors.red);
      return false;
    }
    
    log('✅ OTP sent successfully', colors.green);
    
    // Get the actual OTP from development response
    const actualOTP = otpResponse.data.dummyOtp || '123456';
    log(`   Using OTP: ${actualOTP}`, colors.yellow);
    
    // Step 2: Continue as guest
    log('\n2. Continuing as guest...', colors.cyan);
    const guestResponse = await axios.post(`${API_BASE_URL}/auth/guest-login`, {
      mobile: testMobile,
      otp: actualOTP,
      name: 'Test Guest User',
      issue: 'Testing guest user functionality'
    });
    
    if (!guestResponse.data.success) {
      log('❌ Guest user creation failed', colors.red);
      log(`   Error: ${guestResponse.data.message}`, colors.red);
      return false;
    }
    
    log('✅ Guest user created successfully', colors.green);
    log(`   Guest ID: ${guestResponse.data.data.guest.id}`, colors.yellow);
    
    const guestToken = guestResponse.data.data.token;
    const guestId = guestResponse.data.data.guest.id;
    
    // Step 3: Search for providers
    log('\n3. Searching for providers...', colors.cyan);
    const providersResponse = await axios.get(`${API_BASE_URL}/users/search`, {
      headers: { Authorization: `Bearer ${guestToken}` }
    });
    
    if (!providersResponse.data.success || providersResponse.data.data.length === 0) {
      log('❌ No providers found', colors.red);
      return false;
    }
    
    log(`✅ Found ${providersResponse.data.data.length} providers`, colors.green);
    
    const firstProvider = providersResponse.data.data[0];
    log(`   Using provider: ${firstProvider.fullName} (${firstProvider._id})`, colors.yellow);
    
    // Step 4: Create consultation
    log('\n4. Creating video consultation...', colors.cyan);
    const consultationResponse = await axios.post(`${API_BASE_URL}/consultations`, {
      providerId: firstProvider._id,
      type: 'video',
      paymentCompleted: true
    }, {
      headers: { Authorization: `Bearer ${guestToken}` }
    });
    
    if (!consultationResponse.data.success) {
      log('❌ Failed to create consultation', colors.red);
      log(`   Error: ${consultationResponse.data.message}`, colors.red);
      return false;
    }
    
    log('✅ Consultation created successfully', colors.green);
    log(`   Consultation ID: ${consultationResponse.data.data._id}`, colors.yellow);
    
    const consultationId = consultationResponse.data.data._id;
    
    // Step 5: Retrieve consultation
    log('\n5. Retrieving consultation details...', colors.cyan);
    const getConsultationResponse = await axios.get(`${API_BASE_URL}/consultations/${consultationId}`, {
      headers: { Authorization: `Bearer ${guestToken}` }
    });
    
    if (!getConsultationResponse.data.success) {
      log('❌ Failed to retrieve consultation', colors.red);
      return false;
    }
    
    log('✅ Consultation retrieved successfully', colors.green);
    log(`   Status: ${getConsultationResponse.data.data.status}`, colors.yellow);
    log(`   Type: ${getConsultationResponse.data.data.type}`, colors.yellow);
    
    // Step 6: Test consultation list
    log('\n6. Getting consultation list...', colors.cyan);
    const consultationListResponse = await axios.get(`${API_BASE_URL}/consultations`, {
      headers: { Authorization: `Bearer ${guestToken}` }
    });
    
    if (!consultationListResponse.data.success) {
      log('❌ Failed to get consultation list', colors.red);
      return false;
    }
    
    log(`✅ Retrieved ${consultationListResponse.data.data.length} consultations`, colors.green);
    
    log('\n🎉 All guest user tests passed!', colors.green);
    log('\nTest Summary:', colors.bright);
    log('✅ Guest user registration', colors.green);
    log('✅ Provider search', colors.green);
    log('✅ Consultation creation', colors.green);
    log('✅ Consultation retrieval', colors.green);
    log('✅ Consultation listing', colors.green);
    
    return true;
    
  } catch (error) {
    log(`\n❌ Test failed: ${error.message}`, colors.red);
    if (error.response) {
      log(`   Status: ${error.response.status}`, colors.red);
      log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`, colors.red);
    }
    return false;
  }
}

// Test WebRTC signaling simulation
async function testWebRTCSignaling() {
  try {
    log('\n\n🎥 Testing WebRTC Signaling Simulation', colors.bright);
    log('=' .repeat(50), colors.cyan);
    
    // Generate unique mobile number for WebRTC test
    const webrtcTestMobile = `987655${Math.floor(1000 + Math.random() * 9000)}`;
    
    // Send OTP first
    log(`   Using mobile: ${webrtcTestMobile}`, colors.yellow);
    const otpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
      mobile: webrtcTestMobile,
      purpose: 'guest'
    });
    
    if (!otpResponse.data.success) {
      log('❌ Failed to send OTP for WebRTC test', colors.red);
      return false;
    }
    
    const actualOTP = otpResponse.data.dummyOtp || '123456';
    
    // Create mock guest user
    const guestResponse = await axios.post(`${API_BASE_URL}/auth/guest-login`, {
      mobile: webrtcTestMobile,
      otp: actualOTP,
      name: 'WebRTC Test Guest',
      issue: 'Testing WebRTC functionality'
    });
    
    if (!guestResponse.data.success) {
      log('❌ Failed to create test guest user', colors.red);
      return false;
    }
    
    const guestToken = guestResponse.data.data.token;
    
    log('✅ Created test guest user for WebRTC test', colors.green);
    
    // Try to connect to Socket.IO
    log('\n1. Testing Socket.IO connection...', colors.cyan);
    
    const WebSocket = require('ws');
    
    return new Promise((resolve) => {
      const socket = new WebSocket('ws://localhost:5001', {
        headers: {
          'Authorization': `Bearer ${guestToken}`
        }
      });
      
      let connectionSuccess = false;
      
      socket.on('open', () => {
        log('✅ Socket.IO connection established', colors.green);
        connectionSuccess = true;
        
        // Test consultation join message
        socket.send(JSON.stringify({
          type: 'consultation:join',
          consultationId: 'test-consultation-id'
        }));
        
        setTimeout(() => {
          socket.close();
          log('✅ Socket.IO test completed', colors.green);
          resolve(true);
        }, 2000);
      });
      
      socket.on('error', (error) => {
        log(`❌ Socket.IO connection failed: ${error.message}`, colors.red);
        resolve(false);
      });
      
      socket.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          log(`📨 Received message: ${message.type}`, colors.yellow);
        } catch (e) {
          log(`📨 Received raw message: ${data}`, colors.yellow);
        }
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (!connectionSuccess) {
          log('❌ Socket.IO connection timeout', colors.red);
          socket.close();
          resolve(false);
        }
      }, 10000);
    });
    
  } catch (error) {
    log(`❌ WebRTC test failed: ${error.message}`, colors.red);
    return false;
  }
}

// Run the tests
async function main() {
  const startTime = Date.now();
  
  log('🚀 Starting Guest User and WebRTC Tests', colors.bright);
  log('=' .repeat(60), colors.cyan);
  
  const guestTestResult = await testGuestUserFlow();
  
  // Wait a bit before WebRTC test
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const webrtcTestResult = await testWebRTCSignaling();
  
  // Final report
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  log('\n' + '='.repeat(60), colors.cyan);
  log('                    FINAL REPORT', colors.cyan);
  log('='.repeat(60), colors.cyan);
  
  log(`\nGuest User Flow: ${guestTestResult ? '✅ PASSED' : '❌ FAILED'}`, 
      guestTestResult ? colors.green : colors.red);
  log(`WebRTC Signaling: ${webrtcTestResult ? '✅ PASSED' : '❌ FAILED'}`, 
      webrtcTestResult ? colors.green : colors.red);
  
  log(`\nTotal execution time: ${duration} seconds`, colors.cyan);
  
  if (guestTestResult && webrtcTestResult) {
    log('\n🎉 All tests passed! The system is working correctly.', colors.green);
  } else {
    log('\n⚠️  Some tests failed. Please check the detailed output above.', colors.yellow);
  }
  
  process.exit(guestTestResult && webrtcTestResult ? 0 : 1);
}

main().catch((error) => {
  log(`\n❌ Test execution failed: ${error.message}`, colors.red);
  process.exit(1);
});