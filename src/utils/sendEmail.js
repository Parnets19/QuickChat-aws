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
  totalReports = 0,
  totalBlocks = 0,
  reportHistory = [],
}) => {
  console.log('📧 sendWarningEmail called with:', { userName, userEmail, warningNumber, totalReports, totalBlocks });

  // Build report history rows for the email table
  const historyRows = reportHistory.map((r, i) => `
    <tr style="background: ${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
      <td style="padding: 8px 12px; font-size: 13px; color: #374151;">${i + 1}</td>
      <td style="padding: 8px 12px; font-size: 13px; color: #374151;">${r.reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</td>
      <td style="padding: 8px 12px; font-size: 13px; color: #374151;">${r.reporterName}</td>
      <td style="padding: 8px 12px; font-size: 13px; color: #374151;">${new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      <td style="padding: 8px 12px; font-size: 13px;">
        ${r.isBlocked
          ? '<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:12px;font-size:12px;">Blocked</span>'
          : '<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:12px;font-size:12px;">Report Only</span>'
        }
      </td>
    </tr>
  `).join('');

  // Severity color based on total reports
  const severityColor = totalReports >= 3 ? '#DC2626' : totalReports >= 2 ? '#D97706' : '#F59E0B';
  const headerBg = warningNumber === 'suspended' ? '#DC2626' : severityColor;

  let subject, bodyContent;

  if (warningNumber === 'suspended') {
    subject = `🚫 Your Quick Chat Account Has Been Suspended`;
    bodyContent = `
      <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:16px;margin:20px 0;border-radius:4px;">
        <strong style="color:#dc2626;">⛔ Account Suspended</strong>
        <p style="margin:8px 0 0;color:#7f1d1d;">Your account has been permanently suspended due to repeated violations of our community guidelines.</p>
      </div>
      <p style="color:#374151;">You have accumulated <strong>${totalReports} report${totalReports !== 1 ? 's' : ''}</strong> and <strong>${totalBlocks} block${totalBlocks !== 1 ? 's' : ''}</strong> from other users on the platform.</p>
      <div style="background:#f4f4f4;padding:15px;border-radius:8px;margin:15px 0;">
        <p style="margin:0;"><strong>Latest Reason:</strong> ${reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
        ${adminNotes ? `<p style="margin:8px 0 0;"><strong>Admin Notes:</strong> ${adminNotes}</p>` : ''}
      </div>
      <p style="color:#374151;">If you believe this is a mistake, please contact us at <a href="mailto:${process.env.EMAIL_USER}">${process.env.EMAIL_USER}</a>.</p>
    `;
  } else {
    const ordinal = warningNumber === 1 ? '1st' : warningNumber === 2 ? '2nd' : '3rd';
    const isFinal = warningNumber >= 3;
    subject = `⚠️ ${isFinal ? 'FINAL ' : ''}Warning ${warningNumber}/3 - Quick Chat Community Guidelines`;
    bodyContent = `
      <div style="text-align:center;margin:20px 0;">
        <div style="display:inline-block;background:${severityColor};color:white;border-radius:50%;width:80px;height:80px;line-height:80px;font-size:32px;font-weight:bold;">${warningNumber}/3</div>
        <p style="color:${severityColor};font-weight:bold;margin:8px 0;">${isFinal ? '🚨 FINAL WARNING' : `Warning ${warningNumber} of 3`}</p>
      </div>

      <div style="background:${isFinal ? '#fee2e2' : '#fef3c7'};border-left:4px solid ${severityColor};padding:16px;margin:20px 0;border-radius:4px;">
        <strong>This is your ${ordinal} warning.</strong>
        ${isFinal
          ? ' Any further reports will result in <strong>immediate account suspension</strong>.'
          : ' Please review your behavior and adhere to our community guidelines.'
        }
      </div>

      <div style="background:#f4f4f4;padding:15px;border-radius:8px;margin:15px 0;">
        <p style="margin:0;"><strong>Current Report Reason:</strong> ${reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
        ${adminNotes ? `<p style="margin:8px 0 0;"><strong>Admin Notes:</strong> ${adminNotes}</p>` : ''}
      </div>

      <div style="background:#f0f9ff;border:1px solid #bae6fd;padding:15px;border-radius:8px;margin:15px 0;">
        <p style="margin:0;font-weight:bold;color:#0369a1;">📊 Your Account Summary</p>
        <div style="display:flex;gap:20px;margin-top:10px;">
          <div style="text-align:center;flex:1;background:white;padding:10px;border-radius:6px;">
            <div style="font-size:28px;font-weight:bold;color:${severityColor};">${totalReports}</div>
            <div style="font-size:12px;color:#6b7280;">Total Reports</div>
          </div>
          <div style="text-align:center;flex:1;background:white;padding:10px;border-radius:6px;">
            <div style="font-size:28px;font-weight:bold;color:#dc2626;">${totalBlocks}</div>
            <div style="font-size:12px;color:#6b7280;">Times Blocked</div>
          </div>
          <div style="text-align:center;flex:1;background:white;padding:10px;border-radius:6px;">
            <div style="font-size:28px;font-weight:bold;color:#7c3aed;">${warningNumber}</div>
            <div style="font-size:12px;color:#6b7280;">Warnings Issued</div>
          </div>
        </div>
      </div>
    `;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f3f4f6;">
      <div style="max-width:620px;margin:30px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
        
        <!-- Header -->
        <div style="background:${headerBg};padding:30px 20px;text-align:center;">
          <h1 style="color:white;margin:0;font-size:24px;">
            ${warningNumber === 'suspended' ? '🚫 Account Suspended' : '⚠️ Community Guidelines Warning'}
          </h1>
          <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">Quick Chat Safety Team</p>
        </div>

        <!-- Body -->
        <div style="padding:30px;">
          <h2 style="color:#111827;margin:0 0 16px;">Hello ${userName},</h2>
          
          ${bodyContent}

          <!-- Report History Table -->
          ${reportHistory.length > 0 ? `
          <div style="margin:24px 0;">
            <p style="font-weight:bold;color:#374151;margin-bottom:10px;">📋 Complete Report History (${reportHistory.length} report${reportHistory.length !== 1 ? 's' : ''})</p>
            <div style="overflow-x:auto;border-radius:8px;border:1px solid #e5e7eb;">
              <table style="width:100%;border-collapse:collapse;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">#</th>
                    <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">Reason</th>
                    <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">Reported By</th>
                    <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">Date</th>
                    <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">Action</th>
                  </tr>
                </thead>
                <tbody>${historyRows}</tbody>
              </table>
            </div>
          </div>
          ` : ''}

          <!-- What Happens Next -->
          <div style="background:#f9fafb;border-radius:8px;padding:16px;margin:20px 0;">
            <p style="font-weight:bold;color:#374151;margin:0 0 10px;">What happens next?</p>
            <ul style="margin:0;padding-left:20px;color:#4b5563;font-size:14px;">
              ${warningNumber === 'suspended' ? `
                <li>Your account is now suspended and you cannot log in</li>
                <li>Contact support to appeal this decision</li>
              ` : warningNumber >= 3 ? `
                <li style="color:#dc2626;font-weight:bold;">This is your FINAL warning — next report = suspension</li>
                <li>Strictly follow our community guidelines</li>
                <li>Be respectful to all users on the platform</li>
              ` : `
                <li>Review our community guidelines carefully</li>
                <li>Ensure respectful behavior in all interactions</li>
                <li>${3 - warningNumber} more warning${3 - warningNumber !== 1 ? 's' : ''} before account suspension</li>
              `}
            </ul>
          </div>

          <p style="color:#6b7280;font-size:13px;">Questions? Contact us at <a href="mailto:${process.env.EMAIL_USER}" style="color:#4f46e5;">${process.env.EMAIL_USER}</a></p>
          <p style="color:#374151;font-weight:bold;">Quick Chat Safety Team</p>
        </div>

        <!-- Footer -->
        <div style="background:#f9fafb;padding:16px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">© ${new Date().getFullYear()} Quick Chat. All rights reserved.</p>
          <p style="margin:4px 0 0;font-size:12px;color:#9ca3af;">This is an automated message from the Quick Chat Safety Team.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  console.log('📧 About to call sendEmail with:', { to: userEmail, subject });
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

