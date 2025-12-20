// Debug script to check consultation status
const mongoose = require('mongoose');
require('dotenv').config();

const { Consultation } = require('../src/models');

async function debugConsultation() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const consultationId = '69452a373819d9ac130c5ddb';
    
    const consultation = await Consultation.findById(consultationId);
    
    if (!consultation) {
      console.log('❌ Consultation not found');
      return;
    }

    console.log('📋 Consultation Details:');
    console.log('ID:', consultation._id);
    console.log('Status:', consultation.status);
    console.log('Type:', consultation.type);
    console.log('User:', consultation.user);
    console.log('Provider:', consultation.provider);
    console.log('Start Time:', consultation.startTime);
    console.log('End Time:', consultation.endTime);
    console.log('Duration:', consultation.duration);
    console.log('Rate:', consultation.rate);
    console.log('Total Amount:', consultation.totalAmount);
    console.log('Created At:', consultation.createdAt);
    console.log('Updated At:', consultation.updatedAt);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

debugConsultation();