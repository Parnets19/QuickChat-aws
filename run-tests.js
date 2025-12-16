#!/usr/bin/env node

/**
 * Test Runner Script
 * Runs both API and WebRTC tests for the consultation system
 */

const { spawn } = require('child_process');
const path = require('path');

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

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      ...options
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function checkPrerequisites() {
  log('\n🔍 Checking Prerequisites...', colors.cyan);
  
  try {
    // Check if Node.js is available
    await runCommand('node', ['--version']);
    log('✅ Node.js is available', colors.green);
    
    // Check if backend dependencies are installed
    try {
      await runCommand('npm', ['list', 'axios'], { cwd: './Quick-chat-backend' });
      log('✅ Backend dependencies are installed', colors.green);
    } catch (error) {
      log('⚠️  Installing backend dependencies...', colors.yellow);
      await runCommand('npm', ['install'], { cwd: './Quick-chat-backend' });
    }
    
    // Check if frontend is running
    try {
      const response = await fetch('http://localhost:5173');
      if (response.ok) {
        log('✅ Frontend is running on port 5173', colors.green);
      }
    } catch (error) {
      log('⚠️  Frontend is not running. Please start it with: npm run dev', colors.yellow);
    }
    
    // Check if backend is running
    try {
      const response = await fetch('http://localhost:5001/api/health');
      if (response.ok) {
        log('✅ Backend is running on port 5001', colors.green);
      }
    } catch (error) {
      log('⚠️  Backend is not running. Please start it with: npm start', colors.yellow);
    }
    
    return true;
  } catch (error) {
    log(`❌ Prerequisites check failed: ${error.message}`, colors.red);
    return false;
  }
}

async function runAPITests() {
  log('\n🚀 Running API Tests...', colors.cyan);
  log('=' .repeat(50), colors.cyan);
  
  try {
    await runCommand('node', ['test-consultation-flow.js']);
    log('\n✅ API Tests completed', colors.green);
    return true;
  } catch (error) {
    log(`\n❌ API Tests failed: ${error.message}`, colors.red);
    return false;
  }
}

async function runWebRTCTests() {
  log('\n🎥 Running WebRTC Tests...', colors.cyan);
  log('=' .repeat(50), colors.cyan);
  
  try {
    // Check if puppeteer is installed
    try {
      require('puppeteer');
    } catch (error) {
      log('⚠️  Puppeteer not found. Installing...', colors.yellow);
      await runCommand('npm', ['install', 'puppeteer']);
    }
    
    await runCommand('node', ['test-webrtc-functionality.js']);
    log('\n✅ WebRTC Tests completed', colors.green);
    return true;
  } catch (error) {
    log(`\n❌ WebRTC Tests failed: ${error.message}`, colors.red);
    log('💡 Note: WebRTC tests require a GUI environment and may not work in headless servers', colors.yellow);
    return false;
  }
}

async function main() {
  const startTime = Date.now();
  
  log('🧪 Consultation System Test Suite', colors.bright);
  log('=' .repeat(60), colors.magenta);
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const runApiOnly = args.includes('--api-only');
  const runWebRTCOnly = args.includes('--webrtc-only');
  const skipPrereqs = args.includes('--skip-prereqs');
  
  if (args.includes('--help')) {
    log('\nUsage: node run-tests.js [options]', colors.bright);
    log('\nOptions:', colors.bright);
    log('  --api-only      Run only API tests', colors.cyan);
    log('  --webrtc-only   Run only WebRTC tests', colors.cyan);
    log('  --skip-prereqs  Skip prerequisites check', colors.cyan);
    log('  --help          Show this help message', colors.cyan);
    return;
  }
  
  let apiTestsPassed = false;
  let webrtcTestsPassed = false;
  
  try {
    // Check prerequisites
    if (!skipPrereqs) {
      const prereqsOk = await checkPrerequisites();
      if (!prereqsOk) {
        log('\n❌ Prerequisites check failed. Please fix the issues above and try again.', colors.red);
        return;
      }
    }
    
    // Run API tests
    if (!runWebRTCOnly) {
      apiTestsPassed = await runAPITests();
    }
    
    // Run WebRTC tests
    if (!runApiOnly) {
      webrtcTestsPassed = await runWebRTCTests();
    }
    
  } catch (error) {
    log(`\n❌ Test execution failed: ${error.message}`, colors.red);
  }
  
  // Generate final report
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  log('\n' + '='.repeat(60), colors.magenta);
  log('                    FINAL REPORT', colors.magenta);
  log('='.repeat(60), colors.magenta);
  
  if (!runWebRTCOnly) {
    log(`API Tests: ${apiTestsPassed ? '✅ PASSED' : '❌ FAILED'}`, 
        apiTestsPassed ? colors.green : colors.red);
  }
  
  if (!runApiOnly) {
    log(`WebRTC Tests: ${webrtcTestsPassed ? '✅ PASSED' : '❌ FAILED'}`, 
        webrtcTestsPassed ? colors.green : colors.red);
  }
  
  log(`\nTotal execution time: ${duration} seconds`, colors.cyan);
  
  const allTestsPassed = (runApiOnly ? apiTestsPassed : true) && 
                        (runWebRTCOnly ? webrtcTestsPassed : true) &&
                        (!runApiOnly || apiTestsPassed) &&
                        (!runWebRTCOnly || webrtcTestsPassed);
  
  if (allTestsPassed) {
    log('\n🎉 All tests completed successfully!', colors.green);
    log('The consultation system is working correctly.', colors.green);
  } else {
    log('\n⚠️  Some tests failed. Please check the detailed reports above.', colors.yellow);
  }
  
  // Exit with appropriate code
  process.exit(allTestsPassed ? 0 : 1);
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log(`\n❌ Uncaught Exception: ${error.message}`, colors.red);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`\n❌ Unhandled Rejection: ${reason}`, colors.red);
  process.exit(1);
});

// Run the main function
main().catch(console.error);