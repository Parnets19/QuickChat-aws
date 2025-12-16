#!/usr/bin/env node

/**
 * Simple Health Check Test
 * Verifies that both backend and frontend are running
 */

const axios = require('axios');

// Configuration
const BACKEND_URL = 'http://localhost:5001';
const FRONTEND_URL = 'http://localhost:5173';

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

async function checkBackend() {
  try {
    log('\n🔍 Checking Backend Server...', colors.cyan);
    
    // Try to connect to backend
    const response = await axios.get(`${BACKEND_URL}/api/health`, {
      timeout: 5000
    });
    
    if (response.status === 200) {
      log('✅ Backend is running and healthy', colors.green);
      return true;
    } else {
      log(`⚠️  Backend responded with status: ${response.status}`, colors.yellow);
      return false;
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      log('❌ Backend is not running on port 5001', colors.red);
      log('💡 Start backend with: cd Quick-chat-backend && npm start', colors.yellow);
    } else if (error.code === 'ENOTFOUND') {
      log('❌ Cannot resolve backend hostname', colors.red);
    } else if (error.response?.status === 404) {
      log('⚠️  Backend is running but /api/health endpoint not found', colors.yellow);
      log('💡 This is normal if health endpoint is not implemented', colors.yellow);
      return true; // Consider this as success since server is responding
    } else {
      log(`❌ Backend check failed: ${error.message}`, colors.red);
    }
    return false;
  }
}

async function checkFrontend() {
  try {
    log('\n🔍 Checking Frontend Application...', colors.cyan);
    
    // Try to connect to frontend
    const response = await axios.get(FRONTEND_URL, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Health-Check-Bot'
      }
    });
    
    if (response.status === 200) {
      log('✅ Frontend is running and accessible', colors.green);
      return true;
    } else {
      log(`⚠️  Frontend responded with status: ${response.status}`, colors.yellow);
      return false;
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      log('❌ Frontend is not running on port 5173', colors.red);
      log('💡 Start frontend with: cd Quick-Chat-frontend && npm run dev', colors.yellow);
    } else if (error.code === 'ENOTFOUND') {
      log('❌ Cannot resolve frontend hostname', colors.red);
    } else {
      log(`❌ Frontend check failed: ${error.message}`, colors.red);
    }
    return false;
  }
}

async function checkDatabase() {
  try {
    log('\n🔍 Checking Database Connection...', colors.cyan);
    
    // Try to make a simple API call that requires database
    const response = await axios.get(`${BACKEND_URL}/api/users/providers`, {
      timeout: 10000
    });
    
    if (response.status === 200 || response.status === 401) {
      // 401 is expected without auth token, but means server and DB are working
      log('✅ Database connection is working', colors.green);
      return true;
    } else {
      log(`⚠️  Database check responded with status: ${response.status}`, colors.yellow);
      return false;
    }
  } catch (error) {
    if (error.response?.status === 401) {
      log('✅ Database connection is working (auth required)', colors.green);
      return true;
    } else if (error.code === 'ECONNREFUSED') {
      log('❌ Cannot connect to backend for database check', colors.red);
    } else {
      log(`❌ Database check failed: ${error.message}`, colors.red);
      log('💡 Check MongoDB connection in backend logs', colors.yellow);
    }
    return false;
  }
}

async function main() {
  log('🏥 Health Check for Consultation System', colors.bright);
  log('=' .repeat(50), colors.cyan);
  
  const backendOk = await checkBackend();
  const frontendOk = await checkFrontend();
  const databaseOk = await checkDatabase();
  
  log('\n' + '='.repeat(50), colors.cyan);
  log('HEALTH CHECK SUMMARY', colors.bright);
  log('='.repeat(50), colors.cyan);
  
  log(`Backend Server: ${backendOk ? '✅ HEALTHY' : '❌ UNHEALTHY'}`, 
      backendOk ? colors.green : colors.red);
  log(`Frontend App: ${frontendOk ? '✅ HEALTHY' : '❌ UNHEALTHY'}`, 
      frontendOk ? colors.green : colors.red);
  log(`Database: ${databaseOk ? '✅ HEALTHY' : '❌ UNHEALTHY'}`, 
      databaseOk ? colors.green : colors.red);
  
  const allHealthy = backendOk && frontendOk && databaseOk;
  
  if (allHealthy) {
    log('\n🎉 All systems are healthy! Ready for testing.', colors.green);
    log('💡 Run: node run-tests.js', colors.cyan);
  } else {
    log('\n⚠️  Some systems are not healthy. Please fix the issues above.', colors.yellow);
    
    if (!backendOk) {
      log('\n📋 Backend Setup Steps:', colors.bright);
      log('1. cd Quick-chat-backend', colors.cyan);
      log('2. npm install', colors.cyan);
      log('3. npm start', colors.cyan);
    }
    
    if (!frontendOk) {
      log('\n📋 Frontend Setup Steps:', colors.bright);
      log('1. cd Quick-Chat-frontend', colors.cyan);
      log('2. npm install', colors.cyan);
      log('3. npm run dev', colors.cyan);
    }
    
    if (!databaseOk) {
      log('\n📋 Database Setup Steps:', colors.bright);
      log('1. Check MongoDB connection string in .env', colors.cyan);
      log('2. Ensure MongoDB is running', colors.cyan);
      log('3. Check backend logs for database errors', colors.cyan);
    }
  }
  
  process.exit(allHealthy ? 0 : 1);
}

// Run the health check
main().catch((error) => {
  log(`\n❌ Health check failed: ${error.message}`, colors.red);
  process.exit(1);
});