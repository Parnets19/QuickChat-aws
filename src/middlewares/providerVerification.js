const { AppError } = require('./errorHandler');

// Middleware to check if provider is verified
const requireVerifiedProvider = (req, res, next) => {
  try {
    // Check if user is a service provider
    if (!req.user?.isServiceProvider) {
      return next(new AppError('Access denied. Service provider account required.', 403));
    }

    // Check verification status
    if (req.user.providerVerificationStatus !== 'verified') {
      const statusMessages = {
        pending: 'Your provider account is under verification. Please wait for admin approval.',
        rejected: 'Your provider account verification was rejected. Please contact support.',
      };

      const message = statusMessages[req.user.providerVerificationStatus] || 
                     'Your provider account requires verification.';

      return res.status(403).json({
        success: false,
        message,
        verificationStatus: req.user.providerVerificationStatus,
        verificationRequired: true
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

// Middleware to allow access but return verification status
const checkVerificationStatus = (req, res, next) => {
  try {
    // Add verification status to request for use in controllers
    req.verificationStatus = {
      isVerified: req.user?.providerVerificationStatus === 'verified',
      status: req.user?.providerVerificationStatus || 'pending',
      isServiceProvider: req.user?.isServiceProvider || false
    };

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  requireVerifiedProvider,
  checkVerificationStatus
};