#!/usr/bin/env node

/**
 * Comprehensive Test Script for Guest User Consultation Flow
 * Tests the complete flow from guest registration to WebRTC video/audio calls
 */

const axios = require('axios');
const WebSocket = require('ws');
const { performance } = require('perf_hooks');

// Configuration
const API_BASE_URL = 'http://localhost:5001/api';
const SOCKET_URL = 'ws://localhost:5001';

// Test data
const testProvider = {
  mobile: '9876543211',
  name: 'Test Provider',
  description: 'Test provider for consultation testing'
};

const testGuest = {
  mobile: '9876543212',
  name: 'Test Guest User',
  description: 'Guest user for testing consultations'
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

class ConsultationTester {
  constructor() {
    this.providerToken = null;
    this.guestToken = null;
    this.providerId = null;
    this.guestId = null;
    this.consultationId = null;
    this.providerSocket = null;
    this.guestSocket = null;
    this.testResults = [];
  }

  log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
  }

  logTest(testName, status, details = '') {
    const statusColor = status === 'PASS' ? colors.green : colors.red;
    this.log(`[${statusColor}${status}${colors.reset}] ${testName}${details ? ': ' + details : ''}`, colors.bright);
    this.testResults.push({ test: testName, status, details });
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Test 1: Provider Registration and Login
  async testProviderAuth() {
    try {
      this.log('\n=== Testing Provider Authentication ===', colors.cyan);
      
      // Send OTP
      const otpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        mobile: testProvider.mobile
      });
      
      if (otpResponse.data.success) {
        this.logTest('Provider OTP Send', 'PASS');
      } else {
        this.logTest('Provider OTP Send', 'FAIL', 'OTP send failed');
        return false;
      }

      // Verify OTP (using a mock OTP for testing)
      const verifyResponse = await axios.post(`${API_BASE_URL}/auth/verify-otp`, {
        mobile: testProvider.mobile,
        otp: '123456', // Mock OTP
        fullName: testProvider.name,
        description: testProvider.description,
        isServiceProvider: true
      });

      if (verifyResponse.data.success) {
        this.providerToken = verifyResponse.data.token;
        this.providerId = verifyResponse.data.user._id;
        this.logTest('Provider Registration/Login', 'PASS', `Provider ID: ${this.providerId}`);
        return true;
      } else {
        this.logTest('Provider Registration/Login', 'FAIL', verifyResponse.data.message);
        return false;
      }
    } catch (error) {
      this.logTest('Provider Authentication', 'FAIL', error.response?.data?.message || error.message);
      return false;
    }
  }

  // Test 2: Guest User Registration
  async testGuestAuth() {
    try {
      this.log('\n=== Testing Guest User Authentication ===', colors.cyan);
      
      // Send OTP for guest
      const otpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        mobile: testGuest.mobile
      });
      
      if (otpResponse.data.success) {
        this.logTest('Guest OTP Send', 'PASS');
      } else {
        this.logTest('Guest OTP Send', 'FAIL', 'OTP send failed');
        return false;
      }

      // Continue as guest
      const guestResponse = await axios.post(`${API_BASE_URL}/auth/continue-as-guest`, {
        mobile: testGuest.mobile,
        otp: '123456', // Mock OTP
        fullName: testGuest.name,
        description: testGuest.description
      });

      if (guestResponse.data.success) {
        this.guestToken = guestResponse.data.token;
        this.guestId = guestResponse.data.user.id;
        this.logTest('Guest Registration', 'PASS', `Guest ID: ${this.guestId}`);
        return true;
      } else {
        this.logTest('Guest Registration', 'FAIL', guestResponse.data.message);
        return false;
      }
    } catch (error) {
      this.logTest('Guest Authentication', 'FAIL', error.response?.data?.message || error.message);
      return false;
    }
  }

  // Test 3: Provider Search
  async testProviderSearch() {
    try {
      this.log('\n=== Testing Provider Search ===', colors.cyan);
      
      const searchResponse = await axios.get(`${API_BASE_URL}/users/providers`, {
        headers: { Authorization: `Bearer ${this.guestToken}` }
      });

      if (searchResponse.data.success && searchResponse.data.data.length > 0) {
        const foundProvider = searchResponse.data.data.find(p => p._id === this.providerId);
        if (foundProvider) {
          this.logTest('Provider Search', 'PASS', `Found ${searchResponse.data.data.length} providers`);
          return true;
        } else {
          this.logTest('Provider Search', 'FAIL', 'Test provider not found in search results');
          return false;
        }
      } else {
        this.logTest('Provider Search', 'FAIL', 'No providers found');
        return false;
      }
    } catch (error) {
      this.logTest('Provider Search', 'FAIL', error.response?.data?.message || error.message);
      return false;
    }
  }

  // Test 4: Consultation Creation (Video)
  async testConsultationCreation() {
    try {
      this.log('\n=== Testing Consultation Creation ===', colors.cyan);
      
      const consultationData = {
        providerId: this.providerId,
        type: 'video',
        paymentCompleted: true
      };

      const response = await axios.post(`${API_BASE_URL}/consultations`, consultationData, {
        headers: { Authorization: `Bearer ${this.guestToken}` }
      });

      if (response.data.success) {
        this.consultationId = response.data.data._id;
        this.logTest('Consultation Creation', 'PASS', `Consultation ID: ${this.consultationId}`);
        return true;
      } else {
        this.logTest('Consultation Creation', 'FAIL', response.data.message);
        return false;
      }
    } catch (error) {
      this.logTest('Consultation Creation', 'FAIL', error.response?.data?.message || error.message);
      return false;
    }
  }

  // Test 5: Socket Connection for Provider
  async testProviderSocketConnection() {
    return new Promise((resolve) => {
      try {
        this.log('\n=== Testing Provider Socket Connection ===', colors.cyan);
        
        this.providerSocket = new WebSocket(SOCKET_URL, {
          headers: {
            'Authorization': `Bearer ${this.providerToken}`
          }
        });

        this.providerSocket.on('open', () => {
          this.logTest('Provider Socket Connection', 'PASS');
          resolve(true);
        });

        this.providerSocket.on('error', (error) => {
          this.logTest('Provider Socket Connection', 'FAIL', error.message);
          resolve(false);
        });

        // Timeout after 5 seconds
        setTimeout(() => {
          if (this.providerSocket.readyState !== WebSocket.OPEN) {
            this.logTest('Provider Socket Connection', 'FAIL', 'Connection timeout');
            resolve(false);
          }
        }, 5000);
      } catch (error) {
        this.logTest('Provider Socket Connection', 'FAIL', error.message);
        resolve(false);
      }
    });
  }

  // Test 6: Socket Connection for Guest
  async testGuestSocketConnection() {
    return new Promise((resolve) => {
      try {
        this.log('\n=== Testing Guest Socket Connection ===', colors.cyan);
        
        this.guestSocket = new WebSocket(SOCKET_URL, {
          headers: {
            'Authorization': `Bearer ${this.guestToken}`
          }
        });

        this.guestSocket.on('open', () => {
          this.logTest('Guest Socket Connection', 'PASS');
          resolve(true);
        });

        this.guestSocket.on('error', (error) => {
          this.logTest('Guest Socket Connection', 'FAIL', error.message);
          resolve(false);
        });

        // Timeout after 5 seconds
        setTimeout(() => {
          if (this.guestSocket.readyState !== WebSocket.OPEN) {
            this.logTest('Guest Socket Connection', 'FAIL', 'Connection timeout');
            resolve(false);
          }
        }, 5000);
      } catch (error) {
        this.logTest('Guest Socket Connection', 'FAIL', error.message);
        resolve(false);
      }
    });
  }

  // Test 7: Consultation Room Join
  async testConsultationJoin() {
    return new Promise((resolve) => {
      try {
        this.log('\n=== Testing Consultation Room Join ===', colors.cyan);
        
        let providerJoined = false;
        let guestJoined = false;

        // Provider joins consultation
        this.providerSocket.on('message', (data) => {
          const message = JSON.parse(data);
          if (message.type === 'consultation:joined') {
            providerJoined = true;
            this.logTest('Provider Join Consultation', 'PASS');
            checkBothJoined();
          }
        });

        // Guest joins consultation
        this.guestSocket.on('message', (data) => {
          const message = JSON.parse(data);
          if (message.type === 'consultation:joined') {
            guestJoined = true;
            this.logTest('Guest Join Consultation', 'PASS');
            checkBothJoined();
          }
        });

        const checkBothJoined = () => {
          if (providerJoined && guestJoined) {
            this.logTest('Both Parties Join Consultation', 'PASS');
            resolve(true);
          }
        };

        // Send join messages
        this.providerSocket.send(JSON.stringify({
          type: 'consultation:join',
          consultationId: this.consultationId
        }));

        this.guestSocket.send(JSON.stringify({
          type: 'consultation:join',
          consultationId: this.consultationId
        }));

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!providerJoined || !guestJoined) {
            this.logTest('Consultation Room Join', 'FAIL', 'Join timeout');
            resolve(false);
          }
        }, 10000);
      } catch (error) {
        this.logTest('Consultation Room Join', 'FAIL', error.message);
        resolve(false);
      }
    });
  }

  // Test 8: WebRTC Signaling
  async testWebRTCSignaling() {
    return new Promise((resolve) => {
      try {
        this.log('\n=== Testing WebRTC Signaling ===', colors.cyan);
        
        let offerReceived = false;
        let answerReceived = false;

        // Mock WebRTC offer
        const mockOffer = {
          type: 'offer',
          sdp: 'v=0\r\no=- 123456789 123456789 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
        };

        // Mock WebRTC answer
        const mockAnswer = {
          type: 'answer',
          sdp: 'v=0\r\no=- 987654321 987654321 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
        };

        // Guest listens for offer
        this.guestSocket.on('message', (data) => {
          const message = JSON.parse(data);
          if (message.type === 'webrtc:offer') {
            offerReceived = true;
            this.logTest('WebRTC Offer Received', 'PASS');
            
            // Send answer back
            this.guestSocket.send(JSON.stringify({
              type: 'webrtc:answer',
              consultationId: this.consultationId,
              answer: mockAnswer
            }));
          }
        });

        // Provider listens for answer
        this.providerSocket.on('message', (data) => {
          const message = JSON.parse(data);
          if (message.type === 'webrtc:answer') {
            answerReceived = true;
            this.logTest('WebRTC Answer Received', 'PASS');
            
            if (offerReceived && answerReceived) {
              this.logTest('WebRTC Signaling Complete', 'PASS');
              resolve(true);
            }
          }
        });

        // Provider sends offer
        setTimeout(() => {
          this.providerSocket.send(JSON.stringify({
            type: 'webrtc:offer',
            consultationId: this.consultationId,
            offer: mockOffer
          }));
        }, 1000);

        // Timeout after 15 seconds
        setTimeout(() => {
          if (!offerReceived || !answerReceived) {
            this.logTest('WebRTC Signaling', 'FAIL', 'Signaling timeout');
            resolve(false);
          }
        }, 15000);
      } catch (error) {
        this.logTest('WebRTC Signaling', 'FAIL', error.message);
        resolve(false);
      }
    });
  }

  // Test 9: Consultation End
  async testConsultationEnd() {
    try {
      this.log('\n=== Testing Consultation End ===', colors.cyan);
      
      const response = await axios.put(`${API_BASE_URL}/consultations/${this.consultationId}/end`, {}, {
        headers: { Authorization: `Bearer ${this.providerToken}` }
      });

      if (response.data.success) {
        this.logTest('Consultation End', 'PASS');
        return true;
      } else {
        this.logTest('Consultation End', 'FAIL', response.data.message);
        return false;
      }
    } catch (error) {
      this.logTest('Consultation End', 'FAIL', error.response?.data?.message || error.message);
      return false;
    }
  }

  // Test 10: Consultation Retrieval
  async testConsultationRetrieval() {
    try {
      this.log('\n=== Testing Consultation Retrieval ===', colors.cyan);
      
      // Test guest user retrieving consultation
      const guestResponse = await axios.get(`${API_BASE_URL}/consultations/${this.consultationId}`, {
        headers: { Authorization: `Bearer ${this.guestToken}` }
      });

      if (guestResponse.data.success) {
        this.logTest('Guest Consultation Retrieval', 'PASS');
      } else {
        this.logTest('Guest Consultation Retrieval', 'FAIL', guestResponse.data.message);
        return false;
      }

      // Test provider retrieving consultation
      const providerResponse = await axios.get(`${API_BASE_URL}/consultations/${this.consultationId}`, {
        headers: { Authorization: `Bearer ${this.providerToken}` }
      });

      if (providerResponse.data.success) {
        this.logTest('Provider Consultation Retrieval', 'PASS');
        return true;
      } else {
        this.logTest('Provider Consultation Retrieval', 'FAIL', providerResponse.data.message);
        return false;
      }
    } catch (error) {
      this.logTest('Consultation Retrieval', 'FAIL', error.response?.data?.message || error.message);
      return false;
    }
  }

  // Cleanup
  async cleanup() {
    this.log('\n=== Cleaning Up ===', colors.yellow);
    
    if (this.providerSocket) {
      this.providerSocket.close();
    }
    
    if (this.guestSocket) {
      this.guestSocket.close();
    }
    
    this.log('Cleanup completed', colors.green);
  }

  // Generate test report
  generateReport() {
    this.log('\n' + '='.repeat(60), colors.magenta);
    this.log('                    TEST REPORT', colors.magenta);
    this.log('='.repeat(60), colors.magenta);
    
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(r => r.status === 'PASS').length;
    const failedTests = totalTests - passedTests;
    
    this.log(`\nTotal Tests: ${totalTests}`, colors.bright);
    this.log(`Passed: ${passedTests}`, colors.green);
    this.log(`Failed: ${failedTests}`, failedTests > 0 ? colors.red : colors.green);
    this.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`, colors.bright);
    
    this.log('\nDetailed Results:', colors.bright);
    this.testResults.forEach((result, index) => {
      const statusColor = result.status === 'PASS' ? colors.green : colors.red;
      this.log(`${index + 1}. ${result.test}: ${statusColor}${result.status}${colors.reset}${result.details ? ' - ' + result.details : ''}`);
    });
    
    if (failedTests > 0) {
      this.log('\n⚠️  Some tests failed. Please check the backend server and database connection.', colors.yellow);
    } else {
      this.log('\n🎉 All tests passed! The consultation system is working correctly.', colors.green);
    }
  }

  // Run all tests
  async runAllTests() {
    const startTime = performance.now();
    
    this.log('🚀 Starting Comprehensive Consultation Flow Tests', colors.bright);
    this.log('=' .repeat(60), colors.cyan);
    
    try {
      // Run tests in sequence
      await this.testProviderAuth();
      await this.sleep(1000);
      
      await this.testGuestAuth();
      await this.sleep(1000);
      
      await this.testProviderSearch();
      await this.sleep(1000);
      
      await this.testConsultationCreation();
      await this.sleep(1000);
      
      await this.testProviderSocketConnection();
      await this.sleep(1000);
      
      await this.testGuestSocketConnection();
      await this.sleep(1000);
      
      await this.testConsultationJoin();
      await this.sleep(2000);
      
      await this.testWebRTCSignaling();
      await this.sleep(2000);
      
      await this.testConsultationEnd();
      await this.sleep(1000);
      
      await this.testConsultationRetrieval();
      
    } catch (error) {
      this.log(`\n❌ Test execution failed: ${error.message}`, colors.red);
    } finally {
      await this.cleanup();
      
      const endTime = performance.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      
      this.log(`\nTest execution completed in ${duration} seconds`, colors.cyan);
      this.generateReport();
    }
  }
}

// Run the tests
if (require.main === module) {
  const tester = new ConsultationTester();
  tester.runAllTests().catch(console.error);
}

module.exports = ConsultationTester;