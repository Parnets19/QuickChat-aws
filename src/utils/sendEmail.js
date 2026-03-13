const nodemailer = require('nodemailer');
const { logger } = require('./logger');

// Create transporter lazily to ensure env vars are loaded
let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    console.log('📧 Creating email transporter with config:', {
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: process.env.EMAIL_PORT || '587',
      user: process.env.EMAIL_USER,
      hasPassword: !!process.env.EMAIL_PASSWORD,
    });
    
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false
      }
    });
  }
  return transporter;
};

const sendEmail = async (options) => {
  try {
    console.log('📧 Attempting to send email:', {
      to: options.to,
      subject: options.subject,
      hasHtml: !!options.html,
      hasText: !!options.text,
    });
    
    console.log('📧 Current env vars:', {
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      user: process.env.EMAIL_USER,
      hasPassword: !!process.env.EMAIL_PASSWORD,
    });
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'Quick Chat <noreply@skillhub.com>',
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    };

    console.log('📧 Sending email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
    });

    const emailTransporter = getTransporter();
    const result = await emailTransporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', {
      to: options.to,
      messageId: result.messageId,
    });
    logger.info(`Email sent to ${options.to}`);
    return true;
  } catch (error) {
    console.error('❌ Email send error:', error.message);
    console.error('❌ Email error details:', {
      code: error.code,
      command: error.command,
      response: error.response,
    });
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
            <li>Connect with advisers for consultation</li>
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

const sendReportNotificationEmail = async ({
  reporterName,
  reportedName,
  reportedEmail,
  reason,
  description,
  totalReports,
  isBlocked,
  reportId,
}) => {
  const subject = `🚨 New User Report - ${reportedName} (Total: ${totalReports})`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #DC2626; color: white; padding: 20px; text-align: center; }
        .content { background: #f4f4f4; padding: 30px; }
        .alert { background: #FEE2E2; border-left: 4px solid #DC2626; padding: 15px; margin: 20px 0; }
        .info-box { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
        .label { font-weight: bold; color: #374151; }
        .value { color: #1F2937; margin-left: 10px; }
        .button { background: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
        .warning-level { font-size: 24px; font-weight: bold; color: #DC2626; text-align: center; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>⚠️ New User Report</h1>
        </div>
        <div class="content">
          <div class="alert">
            <strong>Action Required:</strong> A user has been reported on the platform.
          </div>
          
          <div class="info-box">
            <p><span class="label">Reporter:</span><span class="value">${reporterName}</span></p>
            <p><span class="label">Reported User:</span><span class="value">${reportedName}</span></p>
            <p><span class="label">Email:</span><span class="value">${reportedEmail}</span></p>
            <p><span class="label">Reason:</span><span class="value">${reason.replace(/_/g, ' ').toUpperCase()}</span></p>
            <p><span class="label">Blocked:</span><span class="value">${isBlocked ? 'Yes' : 'No'}</span></p>
          </div>

          <div class="info-box">
            <p class="label">Description:</p>
            <p>${description}</p>
          </div>

          <div class="warning-level">
            Total Reports: ${totalReports}
          </div>

          ${totalReports <= 3 ? `
            <div class="alert">
              <strong>Auto-Warning Sent:</strong> Warning email #${totalReports} has been automatically sent to the reported user.
            </div>
          ` : `
            <div class="alert">
              <strong>Admin Action Required:</strong> This user has received ${totalReports} reports. Please review and take appropriate action.
            </div>
          `}

          <p style="text-align: center;">
            <a href="${process.env.ADMIN_URL}/admin/reports/${reportId}" class="button">Review Report</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({ 
    to: process.env.EMAIL_USER || 'Quickchat2026@gmail.com', 
    subject, 
    html 
  });
};

const sendWarningEmail = async ({
  userName,
  userEmail,
  warningNumber,
  reason,
  adminNotes = '',
}) => {
  console.log('📧 sendWarningEmail called with:', {
    userName,
    userEmail,
    warningNumber,
    reason,
    hasAdminNotes: !!adminNotes,
  });
  
  let subject, html;

  if (warningNumber === 'suspended') {
    subject = '🚫 Your Quick Chat Account Has Been Suspended';
    html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #DC2626; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px; }
          .alert { background: #FEE2E2; border-left: 4px solid #DC2626; padding: 15px; margin: 20px 0; }
          .info-box { background: #f4f4f4; padding: 15px; margin: 15px 0; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🚫 Account Suspended</h1>
          </div>
          <div class="content">
            <h2>Hello ${userName},</h2>
            
            <div class="alert">
              <strong>Your Quick Chat account has been suspended.</strong>
            </div>

            <p>Due to multiple reports and violations of our community guidelines, your account has been suspended.</p>

            <div class="info-box">
              <p><strong>Reason:</strong> ${reason.replace(/_/g, ' ')}</p>
              ${adminNotes ? `<p><strong>Admin Notes:</strong> ${adminNotes}</p>` : ''}
            </div>

            <p>If you believe this is a mistake, please contact our support team at ${process.env.EMAIL_USER || 'Quickchat2026@gmail.com'}.</p>

            <p>Thank you for your understanding.</p>
            <p><strong>Quick Chat Team</strong></p>
          </div>
        </div>
      </body>
      </html>
    `;
  } else {
    subject = `⚠️ Warning ${warningNumber}/3 - Quick Chat Community Guidelines`;
    html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #F59E0B; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px; }
          .alert { background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 15px; margin: 20px 0; }
          .info-box { background: #f4f4f4; padding: 15px; margin: 15px 0; border-radius: 5px; }
          .warning-count { font-size: 48px; font-weight: bold; color: #DC2626; text-align: center; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⚠️ Community Guidelines Warning</h1>
          </div>
          <div class="content">
            <h2>Hello ${userName},</h2>
            
            <div class="warning-count">${warningNumber}/3</div>

            <div class="alert">
              <strong>You have received a warning for violating our community guidelines.</strong>
            </div>

            ${warningNumber === 1 ? `
              <p>This is your <strong>first warning</strong>. We've received a report about your behavior on the platform.</p>
            ` : warningNumber === 2 ? `
              <p>This is your <strong>second warning</strong>. Multiple users have reported concerns about your behavior.</p>
            ` : `
              <p>This is your <strong>final warning</strong>. You have received three reports. Any additional violations may result in account suspension.</p>
            `}

            <div class="info-box">
              <p><strong>Reason for Report:</strong> ${reason.replace(/_/g, ' ')}</p>
              ${adminNotes ? `<p><strong>Admin Notes:</strong> ${adminNotes}</p>` : ''}
            </div>

            <p><strong>What happens next?</strong></p>
            <ul>
              ${warningNumber < 3 ? `
                <li>Please review our community guidelines</li>
                <li>Ensure your behavior aligns with our standards</li>
                <li>Future violations may result in account suspension</li>
              ` : `
                <li>This is your final warning</li>
                <li>Any additional reports will result in immediate account suspension</li>
                <li>Please strictly adhere to our community guidelines</li>
              `}
            </ul>

            <p>We value all our users and want to maintain a safe, respectful environment for everyone.</p>

            <p>If you have any questions or believe this warning was issued in error, please contact us at ${process.env.EMAIL_USER || 'Quickchat2026@gmail.com'}.</p>

            <p>Thank you for your cooperation.</p>
            <p><strong>Quick Chat Team</strong></p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  console.log('📧 About to call sendEmail with:', {
    to: userEmail,
    subject,
    htmlLength: html.length,
  });
  
  const result = await sendEmail({ to: userEmail, subject, html });
  console.log('📧 sendWarningEmail result:', result);
  return result;
};

module.exports = {
  sendEmail,
  sendOTPEmail,
  sendWelcomeEmail,
  sendReportNotificationEmail,
  sendWarningEmail,
};

