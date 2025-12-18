const { OTP } = require('../models');

// Generate a 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP (mock implementation for demo)
const sendOTP = async (mobile, purpose = 'login') => {
  try {
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in database
    await OTP.findOneAndUpdate(
      { mobile, purpose },
      {
        mobile,
        otp,
        type: 'mobile', // Required field
        purpose,
        expiresAt,
        attempts: 0,
        isUsed: false
      },
      { upsert: true, new: true }
    );

    // In production, integrate with SMS gateway (Twilio, MSG91, etc.)
    console.log(`📱 OTP for ${mobile}: ${otp} (Purpose: ${purpose})`);

    return {
      success: true,
      message: 'OTP sent successfully',
      // Always return OTP for development - remove this in production
      otp: otp,
      dummyOtp: otp // For backward compatibility
    };
  } catch (error) {
    console.error('Error sending OTP:', error);
    return {
      success: false,
      message: 'Failed to send OTP'
    };
  }
};

// Verify OTP
const verifyOTP = async (mobile, otp, purpose = 'login') => {
  try {
    console.log(`🔍 Verifying OTP - Mobile: ${mobile}, OTP: ${otp}, Purpose: ${purpose}`);
    
    const otpRecord = await OTP.findOne({
      mobile,
      type: 'mobile',
      purpose,
      isUsed: false
    });

    console.log(`🔍 OTP Record found:`, otpRecord ? {
      mobile: otpRecord.mobile,
      otp: otpRecord.otp,
      purpose: otpRecord.purpose,
      isUsed: otpRecord.isUsed,
      expiresAt: otpRecord.expiresAt,
      attempts: otpRecord.attempts
    } : 'No record found');

    if (!otpRecord) {
      return {
        success: false,
        message: 'OTP not found or already used'
      };
    }

    // Check if OTP is expired
    if (new Date() > otpRecord.expiresAt) {
      return {
        success: false,
        message: 'OTP has expired'
      };
    }

    // Check if too many attempts
    if (otpRecord.attempts >= 3) {
      return {
        success: false,
        message: 'Too many failed attempts'
      };
    }

    // Verify OTP
    console.log(`🔍 Comparing OTPs - Stored: ${otpRecord.otp}, Provided: ${otp}`);
    if (otpRecord.otp !== otp) {
      // Increment attempts
      otpRecord.attempts += 1;
      await otpRecord.save();
      
      console.log(`❌ OTP mismatch - Attempts: ${otpRecord.attempts}`);
      return {
        success: false,
        message: 'Invalid OTP'
      };
    }

    // Mark OTP as used
    otpRecord.isUsed = true;
    await otpRecord.save();

    console.log(`✅ OTP verified successfully for ${mobile}`);
    return {
      success: true,
      message: 'OTP verified successfully'
    };
  } catch (error) {
    console.error('Error verifying OTP:', error);
    console.error('Error details:', error.message);
    return {
      success: false,
      message: 'Failed to verify OTP'
    };
  }
};

// Clean up expired OTPs (can be run as a cron job)
const cleanupExpiredOTPs = async () => {
  try {
    const result = await OTP.deleteMany({
      expiresAt: { $lt: new Date() }
    });
    console.log(`🧹 Cleaned up ${result.deletedCount} expired OTPs`);
    return result.deletedCount;
  } catch (error) {
    console.error('Error cleaning up OTPs:', error);
    return 0;
  }
};

module.exports = {
  generateOTP,
  sendOTP,
  verifyOTP,
  cleanupExpiredOTPs
};