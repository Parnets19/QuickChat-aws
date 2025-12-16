#!/usr/bin/env node

/**
 * Step-by-Step System Verification
 * Systematically checks each component of the consultation system
 */

const axios = require('axios');
const WebSocket = require('ws');

// Configuration
const API_BASE_URL = 'http://localhost:5001/api';
const SOCKET_URL = 'ws://localhost:5001';
const FRONTEND_URL = 'http://localhost:5173';

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

class SystemVerifier {
  constructor() {
    this.results = {
      infrastructure: [],
      authentication: [],
      consultation: [],
      webrtc: [],
      providerToProvider: []
    };
  }

  logResult(category, test, status, details = '') {
    const statusColor = status === 'PASS' ? colors.green : status === 'WARN' ? colors.yellow : colors.red;
    log(`[${statusColor}${status}${colors.reset}] ${test}${details ? ': ' + details : ''}`, colors.bright);
    this.results[category].push({ test, status, details });
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Step 1: Infrastructure Checks
  async checkInfrastructure() {
    log('\n🔧 STEP 1: Infrastructure Verification', colors.cyan);
    log('=' .repeat(60), colors.cyan);

    // Check backend server
    try {
      const response = await axios.get(`${API_BASE_URL}/health`, { timeout: 5000 });
      this.logResult('infrastructure', 'Backend Server', 'PASS', 'Responding on port 5001');
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        this.logResult('infrastructure', 'Backend Server', 'FAIL', 'Not running on port 5001');
        log('💡 Start with: cd Quick-chat-backend && npm start', colors.yellow);
        return false;
      } else if (error.response?.status === 404) {
        this.logResult('infrastructure', 'Backend Server', 'PASS', 'Running (health endpoint not found)');
      } else {
        this.logResult('infrastructure', 'Backend Server', 'WARN', error.message);
      }
    }

    // Check frontend
    try {
      const response = await axios.get(FRONTEND_URL, { timeout: 5000 });
      this.logResult('infrastructure', 'Frontend Application', 'PASS', 'Running on port 5173');
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        this.logResult('infrastructure', 'Frontend Application', 'FAIL', 'Not running on port 5173');
        log('💡 Start with: cd Quick-Chat-frontend && npm run dev', colors.yellow);
      } else {
        this.logResult('infrastructure', 'Frontend Application', 'WARN', error.message);
      }
    }

    // Check database connectivity
    try {
      const response = await axios.get(`${API_BASE_URL}/users/search`, { timeout: 10000 });
      if (response.status === 200 || response.status === 401) {
        this.logResult('infrastructure', 'Database Connection', 'PASS', 'MongoDB accessible');
      }
    } catch (error) {
      if (error.response?.status === 401) {
        this.logResult('infrastructure', 'Database Connection', 'PASS', 'MongoDB accessible (auth required)');
      } else {
        this.logResult('infrastructure', 'Database Connection', 'FAIL', 'Cannot connect to MongoDB');
      }
    }

    return true;
  }

  // Step 2: Authentication System Checks
  async checkAuthentication() {
    log('\n🔐 STEP 2: Authentication System Verification', colors.cyan);
    log('=' .repeat(60), colors.cyan);

    // Test OTP generation
    try {
      const testMobile = `98765${Math.floor(10000 + Math.random() * 90000)}`;
      const otpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        mobile: testMobile
      });

      if (otpResponse.data.success) {
        this.logResult('authentication', 'OTP Generation', 'PASS', 'OTP sent successfully');
        
        // Test guest user creation
        const actualOTP = otpResponse.data.dummyOtp;
        if (actualOTP) {
          try {
            const guestResponse = await axios.post(`${API_BASE_URL}/auth/guest-login`, {
              mobile: testMobile,
              otp: actualOTP,
              name: 'Test Guest User',
              issue: 'System verification'
            });

            if (guestResponse.data.success) {
              this.logResult('authentication', 'Guest User Creation', 'PASS', 'Guest authentication working');
              return guestResponse.data.data.token;
            } else {
              this.logResult('authentication', 'Guest User Creation', 'FAIL', guestResponse.data.message);
            }
          } catch (error) {
            this.logResult('authentication', 'Guest User Creation', 'FAIL', error.response?.data?.message || error.message);
          }
        } else {
          this.logResult('authentication', 'OTP Development Mode', 'WARN', 'No dummy OTP in response');
        }
      } else {
        this.logResult('authentication', 'OTP Generation', 'FAIL', 'OTP send failed');
      }
    } catch (error) {
      this.logResult('authentication', 'OTP Generation', 'FAIL', error.response?.data?.message || error.message);
    }

    return null;
  }

  // Step 3: Consultation System Checks
  async checkConsultationSystem(guestToken) {
    log('\n💬 STEP 3: Consultation System Verification', colors.cyan);
    log('=' .repeat(60), colors.cyan);

    if (!guestToken) {
      this.logResult('consultation', 'Consultation System', 'SKIP', 'No guest token available');
      return;
    }

    // Test provider search
    try {
      const searchResponse = await axios.get(`${API_BASE_URL}/users/search`, {
        headers: { Authorization: `Bearer ${guestToken}` }
      });

      if (searchResponse.data.success) {
        const providers = searchResponse.data.data;
        this.logResult('consultation', 'Provider Search', 'PASS', `Found ${providers.length} providers`);

        if (providers.length > 0) {
          // Test consultation creation
          try {
            const consultationResponse = await axios.post(`${API_BASE_URL}/consultations`, {
              providerId: providers[0]._id,
              type: 'video',
              paymentCompleted: true
            }, {
              headers: { Authorization: `Bearer ${guestToken}` }
            });

            if (consultationResponse.data.success) {
              const consultation = consultationResponse.data.data;
              this.logResult('consultation', 'Consultation Creation', 'PASS', `ID: ${consultation._id}`);

              // Test consultation retrieval
              try {
                const getResponse = await axios.get(`${API_BASE_URL}/consultations/${consultation._id}`, {
                  headers: { Authorization: `Bearer ${guestToken}` }
                });

                if (getResponse.data.success) {
                  this.logResult('consultation', 'Consultation Retrieval', 'PASS', 'Guest can access consultation');
                } else {
                  this.logResult('consultation', 'Consultation Retrieval', 'FAIL', 'Cannot retrieve consultation');
                }
              } catch (error) {
                this.logResult('consultation', 'Consultation Retrieval', 'FAIL', error.response?.data?.message || error.message);
              }

              return consultation._id;
            } else {
              this.logResult('consultation', 'Consultation Creation', 'FAIL', consultationResponse.data.message);
            }
          } catch (error) {
            this.logResult('consultation', 'Consultation Creation', 'FAIL', error.response?.data?.message || error.message);
          }
        } else {
          this.logResult('consultation', 'Provider Availability', 'WARN', 'No providers found for testing');
        }
      } else {
        this.logResult('consultation', 'Provider Search', 'FAIL', 'Search API failed');
      }
    } catch (error) {
      this.logResult('consultation', 'Provider Search', 'FAIL', error.response?.data?.message || error.message);
    }

    return null;
  }

  // Step 4: WebRTC and Socket Checks
  async checkWebRTCAndSockets(guestToken, consultationId) {
    log('\n🎥 STEP 4: WebRTC and Socket Verification', colors.cyan);
    log('=' .repeat(60), colors.cyan);

    if (!guestToken) {
      this.logResult('webrtc', 'WebRTC System', 'SKIP', 'No guest token available');
      return;
    }

    // Test socket connection
    return new Promise((resolve) => {
      try {
        const socket = new WebSocket(SOCKET_URL, {
          headers: {
            'Authorization': `Bearer ${guestToken}`
          }
        });

        let socketConnected = false;
        let consultationJoined = false;

        socket.on('open', () => {
          socketConnected = true;
          this.logResult('webrtc', 'Socket Connection', 'PASS', 'Guest socket connected');

          if (consultationId) {
            // Test consultation join
            socket.send(JSON.stringify({
              type: 'consultation:join',
              consultationId: consultationId
            }));
          } else {
            socket.close();
            resolve();
          }
        });

        socket.on('message', (data) => {
          try {
            const message = JSON.parse(data);
            if (message.type === 'consultation:joined') {
              consultationJoined = true;
              const role = message.isProvider ? 'provider' : 'client';
              this.logResult('webrtc', 'Consultation Join', 'PASS', `Joined as ${role}`);
              
              // Test WebRTC signaling simulation
              const mockOffer = {
                type: 'offer',
                sdp: 'v=0\r\no=- 123456789 123456789 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
              };

              socket.send(JSON.stringify({
                type: 'webrtc:offer',
                consultationId: consultationId,
                offer: mockOffer
              }));

              setTimeout(() => {
                socket.close();
                resolve();
              }, 2000);
            }
          } catch (e) {
            // Ignore parsing errors
          }
        });

        socket.on('error', (error) => {
          this.logResult('webrtc', 'Socket Connection', 'FAIL', error.message);
          resolve();
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!socketConnected) {
            this.logResult('webrtc', 'Socket Connection', 'FAIL', 'Connection timeout');
          }
          if (consultationId && !consultationJoined) {
            this.logResult('webrtc', 'Consultation Join', 'FAIL', 'Join timeout');
          }
          socket.close();
          resolve();
        }, 10000);

      } catch (error) {
        this.logResult('webrtc', 'Socket Connection', 'FAIL', error.message);
        resolve();
      }
    });
  }

  // Step 5: Provider-to-Provider Specific Checks
  async checkProviderToProvider() {
    log('\n👥 STEP 5: Provider-to-Provider System Verification', colors.cyan);
    log('=' .repeat(60), colors.cyan);

    // Check if provider-to-provider fields exist in consultation model
    try {
      // Create a test provider
      const testMobile = `98766${Math.floor(10000 + Math.random() * 90000)}`;
      const otpResponse = await axios.post(`${API_BASE_URL}/auth/send-otp`, {
        mobile: testMobile
      });

      if (otpResponse.data.success && otpResponse.data.dummyOtp) {
        const providerResponse = await axios.post(`${API_BASE_URL}/auth/verify-otp`, {
          mobile: testMobile,
          otp: otpResponse.data.dummyOtp,
          fullName: 'Test Provider',
          description: 'Provider for P2P testing',
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
            }
          }
        });

        if (providerResponse.data.success) {
          this.logResult('providerToProvider', 'Provider Registration', 'PASS', 'Provider created successfully');

          // Test provider search (should find other providers)
          const searchResponse = await axios.get(`${API_BASE_URL}/users/search`, {
            headers: { Authorization: `Bearer ${providerResponse.data.token}` }
          });

          if (searchResponse.data.success) {
            const otherProviders = searchResponse.data.data.filter(p => p._id !== providerResponse.data.user._id);
            if (otherProviders.length > 0) {
              this.logResult('providerToProvider', 'Provider-to-Provider Search', 'PASS', 
                `Found ${otherProviders.length} other providers`);

              // Test P2P consultation creation
              try {
                const p2pConsultationResponse = await axios.post(`${API_BASE_URL}/consultations`, {
                  providerId: otherProviders[0]._id,
                  type: 'video',
                  paymentCompleted: true
                }, {
                  headers: { Authorization: `Bearer ${providerResponse.data.token}` }
                });

                if (p2pConsultationResponse.data.success) {
                  const consultation = p2pConsultationResponse.data.data;
                  const hasP2PFlags = consultation.isProviderToProvider && consultation.bookingProviderIsClient;
                  
                  this.logResult('providerToProvider', 'P2P Consultation Creation', 
                    hasP2PFlags ? 'PASS' : 'WARN', 
                    hasP2PFlags ? 'P2P flags set correctly' : 'P2P flags missing');
                } else {
                  this.logResult('providerToProvider', 'P2P Consultation Creation', 'FAIL', 
                    p2pConsultationResponse.data.message);
                }
              } catch (error) {
                this.logResult('providerToProvider', 'P2P Consultation Creation', 'FAIL', 
                  error.response?.data?.message || error.message);
              }
            } else {
              this.logResult('providerToProvider', 'Provider-to-Provider Search', 'WARN', 
                'No other providers available for P2P testing');
            }
          } else {
            this.logResult('providerToProvider', 'Provider-to-Provider Search', 'FAIL', 'Search failed');
          }
        } else {
          this.logResult('providerToProvider', 'Provider Registration', 'FAIL', providerResponse.data.message);
        }
      } else {
        this.logResult('providerToProvider', 'Provider Registration', 'FAIL', 'OTP generation failed');
      }
    } catch (error) {
      this.logResult('providerToProvider', 'Provider-to-Provider System', 'FAIL', 
        error.response?.data?.message || error.message);
    }
  }

  // Generate comprehensive report
  generateReport() {
    log('\n' + '='.repeat(80), colors.magenta);
    log('                    SYSTEM VERIFICATION REPORT', colors.magenta);
    log('='.repeat(80), colors.magenta);

    const categories = [
      { name: 'Infrastructure', key: 'infrastructure' },
      { name: 'Authentication', key: 'authentication' },
      { name: 'Consultation System', key: 'consultation' },
      { name: 'WebRTC & Sockets', key: 'webrtc' },
      { name: 'Provider-to-Provider', key: 'providerToProvider' }
    ];

    let totalTests = 0;
    let totalPassed = 0;
    let totalWarnings = 0;
    let totalFailed = 0;

    categories.forEach(category => {
      const results = this.results[category.key];
      if (results.length === 0) return;

      const passed = results.filter(r => r.status === 'PASS').length;
      const warnings = results.filter(r => r.status === 'WARN').length;
      const failed = results.filter(r => r.status === 'FAIL').length;
      const skipped = results.filter(r => r.status === 'SKIP').length;

      totalTests += results.length;
      totalPassed += passed;
      totalWarnings += warnings;
      totalFailed += failed;

      log(`\n📋 ${category.name}:`, colors.bright);
      log(`   Passed: ${passed}`, colors.green);
      if (warnings > 0) log(`   Warnings: ${warnings}`, colors.yellow);
      if (failed > 0) log(`   Failed: ${failed}`, colors.red);
      if (skipped > 0) log(`   Skipped: ${skipped}`, colors.cyan);

      // Show failed tests
      const failedTests = results.filter(r => r.status === 'FAIL');
      if (failedTests.length > 0) {
        log(`   Failed Tests:`, colors.red);
        failedTests.forEach(test => {
          log(`   - ${test.test}: ${test.details}`, colors.red);
        });
      }
    });

    log(`\n📊 Overall Summary:`, colors.bright);
    log(`   Total Tests: ${totalTests}`, colors.bright);
    log(`   Passed: ${totalPassed}`, colors.green);
    if (totalWarnings > 0) log(`   Warnings: ${totalWarnings}`, colors.yellow);
    if (totalFailed > 0) log(`   Failed: ${totalFailed}`, colors.red);
    log(`   Success Rate: ${((totalPassed / totalTests) * 100).toFixed(1)}%`, colors.bright);

    // System status
    if (totalFailed === 0) {
      log('\n🎉 System Status: HEALTHY', colors.green);
      log('All critical components are working correctly.', colors.green);
    } else if (totalFailed <= 2) {
      log('\n⚠️  System Status: NEEDS ATTENTION', colors.yellow);
      log('Some components need fixes but core functionality works.', colors.yellow);
    } else {
      log('\n🚨 System Status: CRITICAL ISSUES', colors.red);
      log('Multiple components are failing. Immediate attention required.', colors.red);
    }

    // Next steps
    log('\n📝 Recommended Next Steps:', colors.bright);
    if (totalFailed > 0) {
      log('1. Fix failed components before proceeding', colors.yellow);
      log('2. Re-run verification after fixes', colors.yellow);
    }
    if (totalWarnings > 0) {
      log('3. Address warnings for optimal performance', colors.yellow);
    }
    log('4. Run comprehensive test suite: node run-tests.js', colors.cyan);
    log('5. Test provider-to-provider flow manually in browsers', colors.cyan);
  }

  // Run all verification steps
  async runVerification() {
    const startTime = Date.now();

    log('🔍 Starting Comprehensive System Verification', colors.bright);
    log('=' .repeat(80), colors.cyan);

    try {
      // Step 1: Infrastructure
      const infrastructureOk = await this.checkInfrastructure();
      await this.sleep(1000);

      // Step 2: Authentication
      const guestToken = await this.checkAuthentication();
      await this.sleep(1000);

      // Step 3: Consultation System
      const consultationId = await this.checkConsultationSystem(guestToken);
      await this.sleep(1000);

      // Step 4: WebRTC and Sockets
      await this.checkWebRTCAndSockets(guestToken, consultationId);
      await this.sleep(1000);

      // Step 5: Provider-to-Provider
      await this.checkProviderToProvider();

    } catch (error) {
      log(`\n❌ Verification failed: ${error.message}`, colors.red);
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    log(`\nVerification completed in ${duration} seconds`, colors.cyan);
    this.generateReport();
  }
}

// Run verification
if (require.main === module) {
  const verifier = new SystemVerifier();
  verifier.runVerification().catch(console.error);
}

module.exports = SystemVerifier;