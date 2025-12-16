#!/usr/bin/env node

/**
 * Debug Consultation Retrieval
 * Simple test to debug the consultation retrieval issue
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

async function debugConsultationRetrieval() {
  try {
    log('🔍 Debug Consultation Retrieval', colors.bright);
    log('=' .repeat(50), colors.cyan);
    
    // Step 1: Create guest user
    const testMobile = `987654${Math.floor(1000 + Math.random() * 9000)}`;
    
    log('\n1. Creating guest user...', colors.cyan);
    const otpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
      mobile: testMobile,
      purpose: 'guest'
    });
    
    const actualOTP = otpResponse.data.dummyOtp;
    const guestResponse = await axios.post(`${API_BASE_URL}/auth/guest-login`, {
      mobile: testMobile,
      otp: actualOTP,
      name: 'Debug Guest User',
      issue: 'Testing consultation retrieval'
    });
    
    const guestToken = guestResponse.data.data.token;
    const guestId = guestResponse.data.data.guest.id;
    
    log(`✅ Guest user created: ${guestId}`, colors.green);
    
    // Step 2: Get providers
    log('\n2. Getting providers...', colors.cyan);
    const providersResponse = await axios.get(`${API_BASE_URL}/users/search`, {
      headers: { Authorization: `Bearer ${guestToken}` }
    });
    
    const provider = providersResponse.data.data[0];
    log(`✅ Using provider: ${provider.fullName} (${provider._id})`, colors.green);
    
    // Step 3: Create consultation
    log('\n3. Creating consultation...', colors.cyan);
    const consultationResponse = await axios.post(`${API_BASE_URL}/consultations`, {
      providerId: provider._id,
      type: 'video',
      paymentCompleted: true
    }, {
      headers: { Authorization: `Bearer ${guestToken}` }
    });
    
    const consultationId = consultationResponse.data.data._id;
    log(`✅ Consultation created: ${consultationId}`, colors.green);
    log(`   Status: ${consultationResponse.data.data.status}`, colors.yellow);
    log(`   User: ${consultationResponse.data.data.user}`, colors.yellow);
    log(`   Provider: ${consultationResponse.data.data.provider}`, colors.yellow);
    
    // Step 4: Try to retrieve consultation
    log('\n4. Retrieving consultation...', colors.cyan);
    
    try {
      const getResponse = await axios.get(`${API_BASE_URL}/consultations/${consultationId}`, {
        headers: { Authorization: `Bearer ${guestToken}` }
      });
      
      log('✅ Consultation retrieved successfully', colors.green);
      log(`   Retrieved consultation ID: ${getResponse.data.data._id}`, colors.yellow);
      log(`   Retrieved status: ${getResponse.data.data.status}`, colors.yellow);
      
    } catch (retrievalError) {
      log('❌ Failed to retrieve consultation', colors.red);
      log(`   Error: ${retrievalError.response?.status} - ${retrievalError.response?.data?.error}`, colors.red);
      
      // Let's try to get all consultations for this user
      log('\n5. Getting all consultations for user...', colors.cyan);
      try {
        const allConsultationsResponse = await axios.get(`${API_BASE_URL}/consultations`, {
          headers: { Authorization: `Bearer ${guestToken}` }
        });
        
        log(`✅ Found ${allConsultationsResponse.data.data.length} consultations for user`, colors.green);
        allConsultationsResponse.data.data.forEach((consultation, index) => {
          log(`   ${index + 1}. ID: ${consultation._id}, Status: ${consultation.status}, Type: ${consultation.type}`, colors.yellow);
        });
        
        // Check if our consultation is in the list
        const foundConsultation = allConsultationsResponse.data.data.find(c => c._id === consultationId);
        if (foundConsultation) {
          log(`✅ Our consultation IS in the user's consultation list`, colors.green);
        } else {
          log(`❌ Our consultation is NOT in the user's consultation list`, colors.red);
        }
        
      } catch (listError) {
        log(`❌ Failed to get consultation list: ${listError.response?.data?.error}`, colors.red);
      }
    }
    
  } catch (error) {
    log(`\n❌ Debug failed: ${error.message}`, colors.red);
    if (error.response) {
      log(`   Status: ${error.response.status}`, colors.red);
      log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`, colors.red);
    }
  }
}

debugConsultationRetrieval().catch(console.error);