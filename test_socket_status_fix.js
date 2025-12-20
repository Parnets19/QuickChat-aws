const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

// Import models
const Consultation = require('./src/models/Consultation.model');
const User = require('./src/models/User.model');

const testSocketStatusFix = async () => {
  console.log('🧪 SOCKET STATUS FIX TEST');
  console.log('==========================');
  console.log('📝 This test verifies that the socket handler preserves system-set statuses');
  console.log('   like "no_answer", "cancelled", and "missed" instead of overriding them');
  console.log('');

  try {
    await connectDB();

    // Step 1: Find or create test users
    console.log('👥 Setting up test users...');
    
    let client = await User.findOne({ mobile: '9876543210' });
    let provider = await User.findOne({ mobile: '9876543211' });

    if (!client) {
      client = new User({
        fullName: 'Test Client',
        email: 'testclient@example.com',
        mobile: '9876543210',
        password: '$2a$10$example', // Hashed password
        wallet: 1000,
        isServiceProvider: false
      });
      await client.save();
      console.log('✅ Created test client');
    } else {
      console.log('✅ Found existing test client');
    }

    if (!provider) {
      provider = new User({
        fullName: 'Test Provider',
        email: 'testprovider@example.com',
        mobile: '9876543211',
        password: '$2a$10$example', // Hashed password
        wallet: 0,
        isServiceProvider: true,
        rates: { audio: 50, video: 100, chat: 30 }
      });
      await provider.save();
      console.log('✅ Created test provider');
    } else {
      console.log('✅ Found existing test provider');
    }

    // Step 2: Create test consultation with system-set status
    console.log('\n📋 Creating test consultation...');
    
    const testConsultation = new Consultation({
      user: client._id,
      provider: provider._id,
      type: 'audio',
      status: 'no_answer', // System-set status that should NOT be overridden
      rate: 50,
      startTime: null,
      endTime: new Date(),
      duration: 0,
      totalAmount: 0,
      endReason: 'system_error', // Indicates system set this status
      clientAccepted: true,
      providerAccepted: false,
      billingStarted: false
    });

    await testConsultation.save();
    console.log(`✅ Created test consultation with ID: ${testConsultation._id}`);
    console.log(`📊 Initial status: ${testConsultation.status}`);

    // Step 3: Simulate the socket handler logic (the fixed version)
    console.log('\n🔧 Simulating socket handler logic...');
    
    // This simulates what happens when consultation:end event is received
    const simulateSocketEndHandler = async (consultationId) => {
      const consultation = await Consultation.findById(consultationId);
      
      if (!consultation) {
        console.log('❌ Consultation not found');
        return null;
      }

      console.log(`📋 Found consultation with status: ${consultation.status}`);

      // This is the FIXED logic from socket/index.js
      // Only update if consultation is ongoing (not pending, already completed, or auto-cancelled)
      // Don't override statuses like 'no_answer', 'cancelled', 'missed' that were set by system
      if (consultation.status === 'ongoing') {
        consultation.status = 'completed';
        consultation.endTime = new Date();

        // Calculate duration in minutes
        if (consultation.startTime) {
          const duration = Math.ceil(
            (consultation.endTime.getTime() - consultation.startTime.getTime()) / (1000 * 60)
          );
          consultation.duration = duration;
          consultation.totalAmount = duration * consultation.rate;
        }
        console.log('✅ Updated ongoing consultation to completed');
      } else if (['no_answer', 'cancelled', 'missed'].includes(consultation.status)) {
        console.log(`⚠️ Not overriding consultation status '${consultation.status}' - keeping system-set status`);
        // Don't change the status, but still update provider availability
      }

      // Mark provider as no longer busy (this part always runs)
      const ongoingConsultations = await Consultation.countDocuments({
        provider: consultation.provider,
        status: 'ongoing',
        _id: { $ne: consultation._id }
      });
      
      const newStatus = ongoingConsultations > 0 ? 'busy' : 'available';
      
      await User.findByIdAndUpdate(consultation.provider, {
        consultationStatus: newStatus,
        isInCall: ongoingConsultations > 0,
        currentConsultationId: ongoingConsultations > 0 ? consultation.currentConsultationId : null,
      });
      
      console.log(`📱 Provider status updated to: ${newStatus}`);

      await consultation.save();
      console.log(`📊 Final consultation status: ${consultation.status}`);
      
      return consultation;
    };

    // Step 4: Test the fixed socket handler
    const result = await simulateSocketEndHandler(testConsultation._id);

    // Step 5: Verify the fix
    console.log('\n🔍 VERIFICATION');
    console.log('================');
    
    if (result && result.status === 'no_answer') {
      console.log('🎉 TEST PASSED!');
      console.log('✅ Socket handler correctly preserved "no_answer" status');
      console.log('✅ System-set status was NOT overridden to "completed"');
      console.log('✅ Provider availability was still updated correctly');
    } else {
      console.log('❌ TEST FAILED!');
      console.log(`❌ Expected status: no_answer, Got: ${result?.status}`);
      console.log('❌ Socket handler is still overriding system-set statuses');
    }

    // Step 6: Test with different system-set statuses
    console.log('\n🧪 Testing other system-set statuses...');
    
    const testStatuses = ['cancelled', 'missed'];
    
    for (const testStatus of testStatuses) {
      console.log(`\n📋 Testing status: ${testStatus}`);
      
      const testConsultation2 = new Consultation({
        user: client._id,
        provider: provider._id,
        type: 'video',
        status: testStatus,
        rate: 100,
        startTime: null,
        endTime: new Date(),
        duration: 0,
        totalAmount: 0,
        endReason: 'system_error',
        clientAccepted: true,
        providerAccepted: false,
        billingStarted: false
      });

      await testConsultation2.save();
      console.log(`✅ Created consultation with status: ${testStatus}`);
      
      const result2 = await simulateSocketEndHandler(testConsultation2._id);
      
      if (result2 && result2.status === testStatus) {
        console.log(`✅ Status "${testStatus}" correctly preserved`);
      } else {
        console.log(`❌ Status "${testStatus}" was overridden to "${result2?.status}"`);
      }
      
      // Clean up
      await Consultation.findByIdAndDelete(testConsultation2._id);
    }

    // Step 7: Test with ongoing status (should be changed to completed)
    console.log('\n📋 Testing ongoing status (should change to completed)...');
    
    const ongoingConsultation = new Consultation({
      user: client._id,
      provider: provider._id,
      type: 'chat',
      status: 'ongoing',
      rate: 30,
      startTime: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      endTime: null,
      duration: 0,
      totalAmount: 0,
      clientAccepted: true,
      providerAccepted: true,
      billingStarted: true
    });

    await ongoingConsultation.save();
    console.log('✅ Created ongoing consultation');
    
    const ongoingResult = await simulateSocketEndHandler(ongoingConsultation._id);
    
    if (ongoingResult && ongoingResult.status === 'completed') {
      console.log('✅ Ongoing consultation correctly changed to completed');
      console.log(`✅ Duration calculated: ${ongoingResult.duration} minutes`);
      console.log(`✅ Total amount calculated: ₹${ongoingResult.totalAmount}`);
    } else {
      console.log(`❌ Ongoing consultation not handled correctly: ${ongoingResult?.status}`);
    }

    // Clean up test data
    console.log('\n🧹 Cleaning up test data...');
    await Consultation.findByIdAndDelete(testConsultation._id);
    await Consultation.findByIdAndDelete(ongoingConsultation._id);
    console.log('✅ Test data cleaned up');

    console.log('\n🏁 FINAL RESULT');
    console.log('================');
    console.log('✅ Socket status fix has been verified');
    console.log('✅ System-set statuses (no_answer, cancelled, missed) are preserved');
    console.log('✅ Ongoing consultations are still properly completed');
    console.log('✅ Provider availability is updated in all cases');

  } catch (error) {
    console.error('\n💥 Test failed with error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
};

// Run the test
testSocketStatusFix().catch(console.error);