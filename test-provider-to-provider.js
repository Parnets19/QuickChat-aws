#!/usr/bin/env node

/**
 * Provider-to-Provider Consultation Test
 * Tests the complete flow of one provider booking another provider
 */

const axios = require('axios');
const WebSocket = require('ws');

// Configuration
const API_BASE_URL = 'http://localhost:5001/api';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

class ProviderToProviderTester {
  constructor() {
    this.providerA = {
      mobile: null,
      token: null,
      id: null,
      name: 'Provider A',
      socket: null
    };
    
    this.providerB = {
      mobile: null,
      token: null,
      id: null,
      name: 'Provider B',
      socket: null
    };
    
    this.consultation = {
      id: null,
      type: 'video'
    };
    
    this.testResults = [];
  }

  logTest(testName, status, details = '') {
    const statusColor = status === 'PASS' ? colors.green : colors.red;
    log(`[${statusColor}${status}${colors.reset}] ${testName}${details ? ': ' + details : ''}`, colors.bright);
    this.testResults.push({ test: testName, status, details });
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Create a provider user
  async createProvider(providerData, description) {
    try {
      log(`\n=== Creating ${description} ===`, colors.cyan);
      
      // Generate unique mobile number
      providerData.mobile = `98765${Math.floor(10000 + Math.random() * 90000)}`;
      
      // Send OTP
      log(`1. Sending OTP to ${providerData.mobile}...`, colors.cyan);
      const otpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        mobile: providerData.mobile
      });
      
      if (!otpResponse.data.success) {
        this.logTest(`${description} OTP Send`, 'FAIL', 'OTP send failed');
        return false;
      }
      
      const actualOTP = otpResponse.data.dummyOtp;
      log(`   Using OTP: ${actualOTP}`, colors.yellow);
      
      // Verify OTP and register as provider
      log(`2. Registering ${description}...`, colors.cyan);
      const registerResponse = await axios.post(`${API_BASE_URL}/auth/verify-otp`, {
        mobile: providerData.mobile,
        otp: actualOTP,
        fullName: providerData.name,
        description: `${description} for testing provider-to-provider consultations`,
        isServiceProvider: true,
        consultationModes: {
          chat: true,
          audio: true,
          video: true
        },
        rates: {
          chat: 10,
          perMinute: {
            audio: 20,
            video: 30
          },
          defaultChargeType: 'per-minute'
        }
      });
      
      if (!registerResponse.data.success) {
        this.logTest(`${description} Registration`, 'FAIL', registerResponse.data.message);
        return false;
      }
      
      providerData.token = registerResponse.data.token;
      providerData.id = registerResponse.data.user._id;
      
      this.logTest(`${description} Registration`, 'PASS', `ID: ${providerData.id}`);
      return true;
      
    } catch (error) {
      this.logTest(`${description} Creation`, 'FAIL', error.response?.data?.message || error.message);
      return false;
    }
  }

  // Test provider search (Provider A searching for Provider B)
  async testProviderSearch() {
    try {
      log('\n=== Testing Provider Search ===', colors.cyan);
      
      const searchResponse = await axios.get(`${API_BASE_URL}/users/search`, {
        headers: { Authorization: `Bearer ${this.providerA.token}` }
      });
      
      if (!searchResponse.data.success) {
        this.logTest('Provider Search', 'FAIL', 'Search API failed');
        return false;
      }
      
      const providers = searchResponse.data.data;
      const foundProviderB = providers.find(p => p._id === this.providerB.id);
      
      if (!foundProviderB) {
        this.logTest('Provider Search', 'FAIL', `Provider B not found in search results. Found ${providers.length} providers`);
        log(`   Available providers: ${providers.map(p => p.fullName).join(', ')}`, colors.yellow);
        return false;
      }
      
      this.logTest('Provider Search', 'PASS', `Found Provider B in search results (${providers.length} total providers)`);
      return true;
      
    } catch (error) {
      this.logTest('Provider Search', 'FAIL', error.response?.data?.message || error.message);
      return false;
    }
  }

  // Test consultation creation (Provider A books Provider B)
  async testConsultationCreation() {
    try {
      log('\n=== Testing Provider-to-Provider Consultation Creation ===', colors.cyan);
      
      const consultationData = {
        providerId: this.providerB.id,
        type: this.consultation.type,
        paymentCompleted: true
      };
      
      log(`Provider A (${this.providerA.id}) booking Provider B (${this.providerB.id})`, colors.yellow);
      
      const response = await axios.post(`${API_BASE_URL}/consultations`, consultationData, {
        headers: { Authorization: `Bearer ${this.providerA.token}` }
      });
      
      if (!response.data.success) {
        this.logTest('Provider-to-Provider Consultation Creation', 'FAIL', response.data.message);
        return false;
      }
      
      this.consultation.id = response.data.data._id;
      const consultation = response.data.data;
      
      // Verify provider-to-provider flags
      const hasProviderFlags = consultation.isProviderToProvider && consultation.bookingProviderIsClient;
      
      this.logTest('Provider-to-Provider Consultation Creation', 'PASS', 
        `ID: ${this.consultation.id}, P2P Flags: ${hasProviderFlags ? 'Set' : 'Missing'}`);
      
      log(`   Consultation Details:`, colors.yellow);
      log(`   - User (Booking Provider): ${consultation.user}`, colors.yellow);
      log(`   - Provider (Booked Provider): ${consultation.provider}`, colors.yellow);
      log(`   - Is Provider-to-Provider: ${consultation.isProviderToProvider}`, colors.yellow);
      log(`   - Booking Provider Is Client: ${consultation.bookingProviderIsClient}`, colors.yellow);
      
      return true;
      
    } catch (error) {
      this.logTest('Provider-to-Provider Consultation Creation', 'FAIL', 
        error.response?.data?.message || error.message);
      return false;
    }
  }

  // Test socket connections for both providers
  async testSocketConnections() {
    try {
      log('\n=== Testing Socket Connections ===', colors.cyan);
      
      // Connect Provider A
      log('1. Connecting Provider A socket...', colors.cyan);
      const providerAConnected = await this.connectProviderSocket(this.providerA, 'Provider A');
      
      if (!providerAConnected) {
        this.logTest('Provider A Socket Connection', 'FAIL');
        return false;
      }
      
      // Connect Provider B
      log('2. Connecting Provider B socket...', colors.cyan);
      const providerBConnected = await this.connectProviderSocket(this.providerB, 'Provider B');
      
      if (!providerBConnected) {
        this.logTest('Provider B Socket Connection', 'FAIL');
        return false;
      }
      
      this.logTest('Both Provider Socket Connections', 'PASS');
      return true;
      
    } catch (error) {
      this.logTest('Socket Connections', 'FAIL', error.message);
      return false;
    }
  }

  // Connect a provider's socket
  async connectProviderSocket(provider, name) {
    return new Promise((resolve) => {
      try {
        provider.socket = new WebSocket('ws://localhost:5001', {
          headers: {
            'Authorization': `Bearer ${provider.token}`
          }
        });

        provider.socket.on('open', () => {
          log(`   ✅ ${name} socket connected`, colors.green);
          resolve(true);
        });

        provider.socket.on('error', (error) => {
          log(`   ❌ ${name} socket error: ${error.message}`, colors.red);
          resolve(false);
        });

        // Timeout after 5 seconds
        setTimeout(() => {
          if (provider.socket.readyState !== WebSocket.OPEN) {
            log(`   ❌ ${name} socket connection timeout`, colors.red);
            resolve(false);
          }
        }, 5000);
      } catch (error) {
        log(`   ❌ ${name} socket connection failed: ${error.message}`, colors.red);
        resolve(false);
      }
    });
  }

  // Test consultation room joining with role detection
  async testConsultationRoomJoin() {
    try {
      log('\n=== Testing Consultation Room Join & Role Detection ===', colors.cyan);
      
      let providerARole = null;
      let providerBRole = null;
      let joinCount = 0;
      
      return new Promise((resolve) => {
        // Set up message handlers
        this.providerA.socket.on('message', (data) => {
          const message = JSON.parse(data);
          if (message.type === 'consultation:joined') {
            providerARole = message.isProvider ? 'provider' : 'client';
            log(`   Provider A joined as: ${providerARole}`, colors.yellow);
            joinCount++;
            if (joinCount === 2) this.checkRoles();
          }
        });

        this.providerB.socket.on('message', (data) => {
          const message = JSON.parse(data);
          if (message.type === 'consultation:joined') {
            providerBRole = message.isProvider ? 'provider' : 'client';
            log(`   Provider B joined as: ${providerBRole}`, colors.yellow);
            joinCount++;
            if (joinCount === 2) this.checkRoles();
          }
        });

        const checkRoles = () => {
          log(`\n   Role Assignment Results:`, colors.bright);
          log(`   - Provider A (Booking): ${providerARole}`, colors.yellow);
          log(`   - Provider B (Booked): ${providerBRole}`, colors.yellow);
          
          // Expected: Provider A should be 'client', Provider B should be 'provider'
          const rolesCorrect = providerARole === 'client' && providerBRole === 'provider';
          
          if (rolesCorrect) {
            this.logTest('Provider-to-Provider Role Detection', 'PASS', 
              `Booking provider is client, booked provider is provider`);
          } else {
            this.logTest('Provider-to-Provider Role Detection', 'FAIL', 
              `Expected A=client, B=provider. Got A=${providerARole}, B=${providerBRole}`);
          }
          
          resolve(rolesCorrect);
        };

        // Join consultation room
        log('1. Provider A joining consultation room...', colors.cyan);
        this.providerA.socket.send(JSON.stringify({
          type: 'consultation:join',
          consultationId: this.consultation.id
        }));

        log('2. Provider B joining consultation room...', colors.cyan);
        this.providerB.socket.send(JSON.stringify({
          type: 'consultation:start',
          consultationId: this.consultation.id
        }));

        // Timeout after 10 seconds
        setTimeout(() => {
          if (joinCount < 2) {
            this.logTest('Consultation Room Join', 'FAIL', 'Join timeout');
            resolve(false);
          }
        }, 10000);
      });
      
    } catch (error) {
      this.logTest('Consultation Room Join', 'FAIL', error.message);
      return false;
    }
  }

  // Test WebRTC signaling between providers
  async testWebRTCSignaling() {
    try {
      log('\n=== Testing Provider-to-Provider WebRTC Signaling ===', colors.cyan);
      
      let offerReceived = false;
      let answerReceived = false;
      
      return new Promise((resolve) => {
        // Mock WebRTC offer and answer
        const mockOffer = {
          type: 'offer',
          sdp: 'v=0\r\no=- 123456789 123456789 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
        };

        const mockAnswer = {
          type: 'answer',
          sdp: 'v=0\r\no=- 987654321 987654321 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
        };

        // Provider A (client) listens for offer
        this.providerA.socket.on('message', (data) => {
          const message = JSON.parse(data);
          if (message.type === 'webrtc:offer') {
            offerReceived = true;
            log(`   ✅ Provider A (client) received offer from Provider B`, colors.green);
            
            // Send answer back
            this.providerA.socket.send(JSON.stringify({
              type: 'webrtc:answer',
              consultationId: this.consultation.id,
              answer: mockAnswer
            }));
          }
        });

        // Provider B (provider) listens for answer
        this.providerB.socket.on('message', (data) => {
          const message = JSON.parse(data);
          if (message.type === 'webrtc:answer') {
            answerReceived = true;
            log(`   ✅ Provider B (provider) received answer from Provider A`, colors.green);
            
            if (offerReceived && answerReceived) {
              this.logTest('Provider-to-Provider WebRTC Signaling', 'PASS', 
                'Offer/Answer exchange completed');
              resolve(true);
            }
          }
        });

        // Provider B (provider) sends offer (as expected in provider-to-provider)
        setTimeout(() => {
          log('1. Provider B (provider) sending offer...', colors.cyan);
          this.providerB.socket.send(JSON.stringify({
            type: 'webrtc:offer',
            consultationId: this.consultation.id,
            offer: mockOffer
          }));
        }, 2000);

        // Timeout after 15 seconds
        setTimeout(() => {
          if (!offerReceived || !answerReceived) {
            this.logTest('Provider-to-Provider WebRTC Signaling', 'FAIL', 
              `Offer received: ${offerReceived}, Answer received: ${answerReceived}`);
            resolve(false);
          }
        }, 15000);
      });
      
    } catch (error) {
      this.logTest('Provider-to-Provider WebRTC Signaling', 'FAIL', error.message);
      return false;
    }
  }

  // Cleanup connections
  async cleanup() {
    log('\n=== Cleaning Up ===', colors.yellow);
    
    if (this.providerA.socket) {
      this.providerA.socket.close();
    }
    
    if (this.providerB.socket) {
      this.providerB.socket.close();
    }
    
    log('Cleanup completed', colors.green);
  }

  // Generate test report
  generateReport() {
    log('\n' + '='.repeat(70), colors.magenta);
    log('              PROVIDER-TO-PROVIDER TEST REPORT', colors.magenta);
    log('='.repeat(70), colors.magenta);
    
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(r => r.status === 'PASS').length;
    const failedTests = totalTests - passedTests;
    
    log(`\nTotal Tests: ${totalTests}`, colors.bright);
    log(`Passed: ${passedTests}`, colors.green);
    log(`Failed: ${failedTests}`, failedTests > 0 ? colors.red : colors.green);
    log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`, colors.bright);
    
    log('\nDetailed Results:', colors.bright);
    this.testResults.forEach((result, index) => {
      const statusColor = result.status === 'PASS' ? colors.green : colors.red;
      log(`${index + 1}. ${result.test}: ${statusColor}${result.status}${colors.reset}${result.details ? ' - ' + result.details : ''}`);
    });
    
    if (failedTests > 0) {
      log('\n⚠️  Some tests failed. Provider-to-provider consultations need fixes.', colors.yellow);
      log('\nCommon Issues:', colors.bright);
      log('- Role detection not working properly', colors.yellow);
      log('- WebRTC signaling blocked by role checks', colors.yellow);
      log('- Provider-to-provider flags not set correctly', colors.yellow);
    } else {
      log('\n🎉 All tests passed! Provider-to-provider consultations are working correctly.', colors.green);
    }
  }

  // Run all tests
  async runAllTests() {
    const startTime = Date.now();
    
    log('🚀 Starting Provider-to-Provider Consultation Tests', colors.bright);
    log('=' .repeat(70), colors.cyan);
    
    try {
      // Create both providers
      const providerACreated = await this.createProvider(this.providerA, 'Provider A (Booking)');
      if (!providerACreated) return;
      
      await this.sleep(1000);
      
      const providerBCreated = await this.createProvider(this.providerB, 'Provider B (Booked)');
      if (!providerBCreated) return;
      
      await this.sleep(1000);
      
      // Test provider search
      const searchWorked = await this.testProviderSearch();
      if (!searchWorked) return;
      
      await this.sleep(1000);
      
      // Test consultation creation
      const consultationCreated = await this.testConsultationCreation();
      if (!consultationCreated) return;
      
      await this.sleep(1000);
      
      // Test socket connections
      const socketsConnected = await this.testSocketConnections();
      if (!socketsConnected) return;
      
      await this.sleep(2000);
      
      // Test consultation room join and role detection
      const rolesCorrect = await this.testConsultationRoomJoin();
      
      await this.sleep(2000);
      
      // Test WebRTC signaling
      await this.testWebRTCSignaling();
      
    } catch (error) {
      log(`\n❌ Test execution failed: ${error.message}`, colors.red);
    } finally {
      await this.cleanup();
      
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      
      log(`\nTest execution completed in ${duration} seconds`, colors.cyan);
      this.generateReport();
    }
  }
}

// Run the tests
if (require.main === module) {
  const tester = new ProviderToProviderTester();
  tester.runAllTests().catch(console.error);
}

module.exports = ProviderToProviderTester;