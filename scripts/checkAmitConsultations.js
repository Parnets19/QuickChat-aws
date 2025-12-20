// Check Amit's consultations as a client
const mongoose = require('mongoose');
require('dotenv').config();

const { Consultation, User } = require('../src/models');

async function checkAmitConsultations() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    console.log('MongoDB URI:', process.env.MONGODB_URI ? 'Found' : 'Not found');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const amitId = '6937d5da082dde1474b170b9';
    const raviId = '693bb59f52886864ad343644';
    
    console.log('\n🔍 CHECKING AMIT\'S CONSULTATIONS AS CLIENT');
    console.log('=' .repeat(50));

    // Get all consultations where Amit is the client (user field)
    const consultationsAsClient = await Consultation.find({
      user: amitId
    }).populate('provider', 'fullName email')
      .populate('user', 'fullName email')
      .sort({ createdAt: -1 });

    console.log(`📊 Found ${consultationsAsClient.length} consultations where Amit is the client:`);
    
    if (consultationsAsClient.length > 0) {
      consultationsAsClient.forEach((consultation, index) => {
        console.log(`\n${index + 1}. Consultation ID: ${consultation._id}`);
        console.log(`   📅 Created: ${new Date(consultation.createdAt).toLocaleString()}`);
        console.log(`   👤 Client: ${consultation.user?.fullName} (${consultation.user?._id})`);
        console.log(`   👨‍⚕️ Provider: ${consultation.provider?.fullName} (${consultation.provider?._id})`);
        console.log(`   📞 Type: ${consultation.type}`);
        console.log(`   📊 Status: ${consultation.status}`);
        console.log(`   💰 Amount: ₹${consultation.totalAmount || 0}`);
        console.log(`   ⏱️ Duration: ${consultation.duration || 0} minutes`);
        console.log(`   🏁 Start: ${consultation.startTime ? new Date(consultation.startTime).toLocaleString() : 'N/A'}`);
        console.log(`   🏁 End: ${consultation.endTime ? new Date(consultation.endTime).toLocaleString() : 'N/A'}`);
      });
    } else {
      console.log('❌ No consultations found where Amit is the client');
    }

    // Also check if there are any consultations where Amit is the provider
    const consultationsAsProvider = await Consultation.find({
      provider: amitId
    }).populate('provider', 'fullName email')
      .populate('user', 'fullName email')
      .sort({ createdAt: -1 });

    console.log(`\n📊 Found ${consultationsAsProvider.length} consultations where Amit is the provider:`);
    
    if (consultationsAsProvider.length > 0) {
      consultationsAsProvider.forEach((consultation, index) => {
        console.log(`\n${index + 1}. Consultation ID: ${consultation._id}`);
        console.log(`   👤 Client: ${consultation.user?.fullName} (${consultation.user?._id})`);
        console.log(`   👨‍⚕️ Provider: ${consultation.provider?.fullName} (${consultation.provider?._id})`);
        console.log(`   📊 Status: ${consultation.status}`);
      });
    }

    // Check the specific consultation we know about
    const specificConsultation = await Consultation.findById('69452a373819d9ac130c5ddb')
      .populate('provider', 'fullName email')
      .populate('user', 'fullName email');

    if (specificConsultation) {
      console.log('\n🎯 SPECIFIC CONSULTATION (69452a373819d9ac130c5ddb):');
      console.log(`   👤 Client: ${specificConsultation.user?.fullName} (${specificConsultation.user?._id})`);
      console.log(`   👨‍⚕️ Provider: ${specificConsultation.provider?.fullName} (${specificConsultation.provider?._id})`);
      console.log(`   📊 Status: ${specificConsultation.status}`);
      console.log(`   💰 Amount: ₹${specificConsultation.totalAmount || 0}`);
      console.log(`   📞 Type: ${specificConsultation.type}`);
      console.log(`   📅 Created: ${new Date(specificConsultation.createdAt).toLocaleString()}`);
      
      // Check if this consultation should appear for Amit as client
      const isAmitClient = specificConsultation.user?._id.toString() === amitId;
      const isAmitProvider = specificConsultation.provider?._id.toString() === amitId;
      
      console.log(`   🔍 Is Amit the client? ${isAmitClient}`);
      console.log(`   🔍 Is Amit the provider? ${isAmitProvider}`);
    } else {
      console.log('\n❌ Specific consultation not found');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

checkAmitConsultations();