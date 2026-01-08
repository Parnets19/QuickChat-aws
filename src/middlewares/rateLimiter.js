const rateLimit = require("express-rate-limit");

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000"), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100"),
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limiter for auth routes
const authLimiter = (req, res, next) => {
  // Temporarily disable rate limiting in development
  if (process.env.NODE_ENV === "development") {
    return next();
  }

  // Original rate limiter for production
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes in prod
    max: 10, // 10 attempts in prod
    message: "Too many authentication attempts, please try again later.",
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
  })(req, res, next);
};

// OTP request limiter
const otpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 2,
  message: "Too many OTP requests, please try again after 1 minute.",
});

// Payment limiter
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: "Too many payment requests, please try again later.",
});

module.exports = {
  apiLimiter,
  authLimiter,
  otpLimiter,
  paymentLimiter,
};
