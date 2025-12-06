const nodemailer = require('nodemailer');
const { logger } = require('./logger');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

const sendEmail = async (options) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'Quick Chat <noreply@skillhub.com>',
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Email sent to ${options.to}`);
    return true;
  } catch (error) {
    logger.error('Email send error:', error);
    return false;
  }
};

const sendOTPEmail = async (email, otp, purpose) => {
  const subject = `Your OTP for ${purpose}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
        .content { background: #f4f4f4; padding: 30px; }
        .otp { font-size: 32px; font-weight: bold; color: #4F46E5; text-align: center; letter-spacing: 5px; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Quick Chat</h1>
        </div>
        <div class="content">
          <h2>Your OTP Code</h2>
          <p>Your OTP for ${purpose} is:</p>
          <p class="otp">${otp}</p>
          <p>This OTP will expire in 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Quick Chat. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({ to: email, subject, html });
};

const sendWelcomeEmail = async (email, name) => {
  const subject = 'Welcome to Quick Chat!';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; }
        .button { background: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to Quick Chat!</h1>
        </div>
        <div class="content">
          <h2>Hello ${name},</h2>
          <p>Welcome to Quick Chat - Your one-stop platform for consultation and services.</p>
          <p>You can now:</p>
          <ul>
            <li>Offer your skills and services</li>
            <li>Connect with experts for consultation</li>
            <li>Manage your wallet and earnings</li>
            <li>And much more!</li>
          </ul>
          <p>Get started today and explore endless possibilities.</p>
          <a href="${process.env.FRONTEND_URL}" class="button">Get Started</a>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({ to: email, subject, html });
};

module.exports = {
  sendEmail,
  sendOTPEmail,
  sendWelcomeEmail,
};

