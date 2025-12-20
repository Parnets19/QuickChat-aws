// Debug the consultation user field to see what's stored
const mongoose = require('mongoose');
require('dotenv').config();

const { Consultation } = require('../src/models');

async function debugConsultationUser() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const consultationId = '69452a373819d9ac130c5ddb';
    const amitId = '6937d5da082dde1474b170b9';
    
    console.log('\n🔍 DEBUGGING CONSULTATION USER FIELD');
    console.log('=' .repeat(50));

    // Get the specific consultation
    const consultation = await Consultation.findById(consultationId);
    
    if (consultation) {
      console.log('📋 Consultation found:');
      console.log(`   ID: ${consultation._id}`);
      console.log(`   User field type: ${typeof consultation.user}`);
      console.log(`   User field value: ${consultation.user}`);
      console.log(`   User field constructor: ${consultation.user?.constructor?.name}`);
      console.log(`   Provider field type: ${typeof consultation.provider}`);
      console.log(`   Provider field value: ${consultation.provider}`);
      console.log(`   Status: ${consultation.status}`);
      console.log(`   UserType: ${consultation.userType}`);
      
      // Check if user field matches Amit's ID
      const userMatches = consultation.user?.toString() === amitId;
      console.log(`   Does user field match Amit's ID? ${userMatches}`);
      
      // Try different query approaches
      console.log('\n🔍 Testing different query approaches:');
      
      // 1. Direct ObjectId query
      const query1 = await Consultation.find({ user: new mongoose.Types.ObjectId(amitId) });
      console.log(`   1. ObjectId query: ${query1.length} results`);
      
      // 2. String query
      const query2 = await Consultation.find({ user: amitId });
      console.log(`   2. String query: ${query2.length} results`);
      
      // 3. Mixed query with $or
      const query3 = await Consultation.find({
        $or: [
          { user: new mongoose.Types.ObjectId(amitId) },
          { user: amitId }
        ]
      });
      console.log(`   3. Mixed $or query: ${query3.length} results`);
      
      // 4. Check all consultations for this user
      const allConsultations = await Consultation.find({});
      console.log(`\n📊 All consultations in database: ${allConsultations.length}`);
      
      allConsultations.forEach((c, index) => {
        const userStr = c.user?.toString();
        const isAmit = userStr === amitId;
        console.log(`   ${index + 1}. ${c._id} - User: ${userStr} (${typeof c.user}) - IsAmit: ${isAmit}`);
      });
      
    } else {
      console.log('❌ Consultation not found');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

debugConsultationUser();