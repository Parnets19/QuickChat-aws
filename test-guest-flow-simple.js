#!/usr/bin/env node

/**
 * Simple Guest User Flow Test
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
    
    // Step 1: Send OTP for guest user
    log('\n1. Sending OTP for guest user...', colors.cyan);
    const otpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
      mobile: '9876543212'
    });
    
    if (!otpResponse.data.success) {
      log('❌ OTP send failed', colors.red);
      return;
    }
    
    log('✅ OTP sent successfully', colors.green);
    
    // Get the actual OTP from development response
    const actualOTP = otpResponse.data.dummyOtp || '123456';
    log(`   Using OTP: ${actualOTP}`, colors.yellow);
    
    // Step 2: Continue as guest
    log('\n2. Continuing as guest...', colors.cyan);
    const guestResponse = await axios.post(`${API_BASE_URL}/auth/guest-login`, {
      mobile: '9876543212',
      otp: actualOTP,
      name: 'Test Guest User',
      issue: 'Testing guest user functionality'
    });
    
    if (!guestResponse.data.success) {
      log('❌ Guest user creation failed', colors.red);
      log(`   Error: ${guestResponse.data.message}`, colors.red);
      return;
    }
    
    log('✅ Guest user created successfully', colors.green);
    log(`   Guest ID: ${guestResponse.data.data.guest.id}`, colors.yellow);
    
    const guestToken = guestResponse.data.data.token;
    const guestId = guestResponse.data.data.guest.id;
      
      // Step 3: Search for providers
      log('\n3. Searching for providers...', colors.cyan);
      const providersResponse = await axios.get(`${API_BASE_URL}/users/providers`, {
        headers: { Authorization: `Bearer ${guestToken}` }
      });
      
      if (providersResponse.data.success && providersResponse.data.data.length > 0) {
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
        
        if (consultationResponse.data.success) {
          log('✅ Consultation created successfully', colors.green);
          log(`   Consultation ID: ${consultationResponse.data.data._id}`, colors.yellow);
          
          const consultationId = consultationResponse.data.data._id;
          
          // Step 5: Retrieve consultation
          log('\n5. Retrieving consultation details...', colors.cyan);
          const getConsultationResponse = await axios.get(`${API_BASE_URL}/consultations/${consultationId}`, {
            headers: { Authorization: `Bearer ${guestToken}` }
          });
          
          if (getConsultationResponse.data.success) {
            log('✅ Consultation retrieved successfully', colors.green);
            log(`   Status: ${getConsultationResponse.data.data.status}`, colors.yellow);
            log(`   Type: ${getConsultationResponse.data.data.type}`, colors.yellow);
            
            // Step 6: Test consultation list
            log('\n6. Getting consultation list...', colors.cyan);
            const consultationListResponse = await axios.get(`${API_BASE_URL}/consultations`, {
              headers: { Authorization: `Bearer ${guestToken}` }
            });
            
            if (consultationListResponse.data.success) {
              log(`✅ Retrieved ${consultationListResponse.data.data.length} consultations`, colors.green);
              
              log('\n🎉 All guest user tests passed!', colors.green);
              log('\nTest Summary:', colors.bright);
              log('✅ Guest user registration', colors.green);
              log('✅ Provider search', colors.green);
              log('✅ Consultation creation', colors.green);
              log('✅ Consultation retrieval', colors.green);
              log('✅ Consultation listing', colors.green);
              
            } else {
              log('❌ Failed to get consultation list', colors.red);
            }
          } else {
            log('❌ Failed to retrieve consultation', colors.red);
          }
        } else {
          log('❌ Failed to create consultation', colors.red);
          log(`   Error: ${consultationResponse.data.message}`, colors.red);
        }
      } else {
        log('❌ No providers found', colors.red);
      }
    } else {
      log('❌ Guest user creation failed', colors.red);
      log(`   Error: ${guestResponse.data.message}`, colors.red);
    }
    
  } catch (error) {
    log(`\n❌ Test failed: ${error.message}`, colors.red);
    if (error.response) {
      log(`   Status: ${error.response.status}`, colors.red);
      log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`, colors.red);
    }
  }
}

// Test WebRTC signaling simulation
async function testWebRTCSignaling() {
  try {
    log('\n\n🎥 Testing WebRTC Signaling Simulation', colors.bright);
    log('=' .repeat(50), colors.cyan);
    
    // This is a simplified test that doesn't require actual WebRTC
    // It just tests the Socket.IO message handling
    
    const WebSocket = require('ws');
    
    // Send OTP first
    const otpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
      mobile: '9876543213'
    });
    
    if (!otpResponse.data.success) {
      log('❌ Failed to send OTP for WebRTC test', colors.red);
      return;
    }
    
    const actualOTP = otpResponse.data.dummyOtp || '123456';
    
    // Create mock guest user
    const guestResponse = await axios.post(`${API_BASE_URL}/auth/guest-login`, {
      mobile: '9876543213',
      otp: actualOTP,
      name: 'WebRTC Test Guest',
      issue: 'Testing WebRTC functionality'
    });
    
    if (guestResponse.data.success) {
      const guestToken = guestResponse.data.data.token;
      
      log('✅ Created test guest user for WebRTC test', colors.green);
      
      // Try to connect to Socket.IO
      log('\n1. Testing Socket.IO connection...', colors.cyan);
      
      const socket = new WebSocket('ws://localhost:5001', {
        headers: {
          'Authorization': `Bearer ${guestToken}`
        }
      });
      
      socket.on('open', () => {
        log('✅ Socket.IO connection established', colors.green);
        
        // Test consultation join message
        socket.send(JSON.stringify({
          type: 'consultation:join',
          consultationId: 'test-consultation-id'
        }));
        
        setTimeout(() => {
          socket.close();
          log('✅ Socket.IO test completed', colors.green);
        }, 2000);
      });
      
      socket.on('error', (error) => {
        log(`❌ Socket.IO connection failed: ${error.message}`, colors.red);
      });
      
      socket.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          log(`📨 Received message: ${message.type}`, colors.yellow);
        } catch (e) {
          log(`📨 Received raw message: ${data}`, colors.yellow);
        }
      });
      
    } else {
      log('❌ Failed to create test guest user', colors.red);
    }
    
  } catch (error) {
    log(`❌ WebRTC test failed: ${error.message}`, colors.red);
  }
}

// Run the tests
async function main() {
  await testGuestUserFlow();
  
  // Wait a bit before WebRTC test
  setTimeout(async () => {
    await testWebRTCSignaling();
  }, 2000);
}

main().catch(console.error);