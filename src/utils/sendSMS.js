const twilio = require('twilio');
const { logger } = require('./logger');

// Initialize Twilio client only if credentials are available
let client = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    logger.info('Twilio client initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Twilio client:', error.message);
  }
} else {
  logger.warn('Twilio credentials not found. SMS functionality will be disabled.');
}

const sendSMS = async (mobile, message) => {
  try {
    // Check if Twilio client is available
    if (!client) {
      logger.warn('Twilio client not available. SMS not sent:', { mobile, message: message.substring(0, 50) + '...' });
      return false;
    }

    // Check if phone number is configured
    if (!process.env.TWILIO_PHONE_NUMBER) {
      logger.warn('Twilio phone number not configured. SMS not sent:', { mobile, message: message.substring(0, 50) + '...' });
      return false;
    }

    // Ensure mobile number has country code
    const formattedMobile = mobile.startsWith('+') ? mobile : `+91${mobile}`;

    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedMobile,
    });

    logger.info(`SMS sent to ${formattedMobile}`);
    return true;
  } catch (error) {
    logger.error('SMS send error:', error);
    return false;
  }
};

const sendOTPSMS = async (mobile, otp) => {
  const message = `Your OTP for Quick Chat is: ${otp}. Valid for 10 minutes. Do not share this OTP with anyone.`;
  return await sendSMS(mobile, message);
};

module.exports = {
  sendSMS,
  sendOTPSMS,
};

