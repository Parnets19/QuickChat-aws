// Auto-process completed consultations that have no transactions
const { Consultation, User, Guest, Transaction } = require('./models');
const { addEarnings } = require('./controllers/earnings.controller');

async function autoProcessCompletedConsultations() {
  try {
    console.log('🔄 Checking for completed consultations without transactions...');

    // Find completed consultations that have no transactions
    const completedConsultations = await Consultation.find({
      status: 'completed',
      totalAmount: { $gt: 0 } // Has an amount to process
    });

    console.log(`📋 Found ${completedConsultations.length} completed consultations`);

    for (const consultation of completedConsultations) {
      // Check if transactions already exist for this consultation
      const existingClientTx = await Transaction.findOne({
        consultationId: consultation._id,
        type: { $in: ['consultation_payment', 'debit'] }
      });

      const existingProviderTx = await Transaction.findOne({
        consultationId: consultation._id,
        type: 'earning'
      });

      if (!existingClientTx || !existingProviderTx) {
        console.log(`\n🔧 Processing consultation ${consultation._id}:`);
        console.log(`   Amount: ₹${consultation.totalAmount}`);
        console.log(`   Duration: ${consultation.duration} minutes`);
        console.log(`   Client transaction exists: ${!!existingClientTx}`);
        console.log(`   Provider transaction exists: ${!!existingProviderTx}`);

        // Get users - handle both regular users and guest users
        let client, provider;
        
        // Get client (could be User or Guest)
        if (consultation.userType === 'Guest') {
          client = await Guest.findById(consultation.user);
        } else {
          client = await User.findById(consultation.user);
        }
        
        // Provider is always a User
        provider = await User.findById(consultation.provider);

        if (!client || !provider) {
          console.log(`   ❌ Users not found (client: ${!!client}, provider: ${!!provider}), skipping...`);
          continue;
        }

        console.log(`   👤 Client: ${client.fullName || client.name} (${consultation.userType})`);
        console.log(`   👤 Provider: ${provider.fullName}`);

        const totalAmount = consultation.totalAmount;
        const PLATFORM_COMMISSION_RATE = 0.05;
        const platformCommission = Math.round(totalAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
        const providerEarnings = Math.round((totalAmount - platformCommission) * 100) / 100;

        // Process client deduction if missing
        if (!existingClientTx) {
          console.log(`   💸 Deducting ₹${totalAmount} from client`);
          client.wallet -= totalAmount;
          
          // Update totalSpent for both regular users and guest users
          client.totalSpent = (client.totalSpent || 0) + totalAmount;
          
          await client.save();

          await Transaction.create({
            user: client._id,
            userType: consultation.userType, // Use the correct userType
            type: 'consultation_payment',
            category: 'consultation',
            amount: totalAmount,
            balance: client.wallet,
            status: 'completed',
            description: `${consultation.type} consultation with ${provider.fullName}`,
            consultationId: consultation._id,
            transactionId: `AUTO_CLIENT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          });
        }

        // Process provider earnings if missing
        if (!existingProviderTx) {
          console.log(`   💰 Adding ₹${providerEarnings} to provider`);
          provider.wallet += providerEarnings;
          provider.earnings = (provider.earnings || 0) + providerEarnings;
          await provider.save();

          await Transaction.create({
            user: provider._id,
            userType: 'User',
            type: 'earning',
            category: 'consultation',
            amount: providerEarnings,
            balance: provider.wallet,
            status: 'completed',
            description: `${consultation.type.charAt(0).toUpperCase() + consultation.type.slice(1)} Consultation - ${client.fullName || client.name}`,
            consultationId: consultation._id,
            transactionId: `AUTO_PROVIDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            metadata: {
              clientName: client.fullName || client.name,
              consultationType: consultation.type,
              duration: consultation.duration,
              rate: consultation.rate,
              platformCommission,
              grossAmount: totalAmount,
              netAmount: providerEarnings
            }
          });
        }

        console.log(`   ✅ Consultation processed successfully`);
      }
    }

    console.log('\n✅ Auto-processing completed');
  } catch (error) {
    console.error('❌ Error in auto-processing:', error);
  }
}

module.exports = { autoProcessCompletedConsultations };