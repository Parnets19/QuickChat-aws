const jwt = require("jsonwebtoken");
const { User } = require("../models");
const { AppError } = require("./errorHandler");

const protect = async (req, res, next) => {
  try {
    let token;

    // Check for token in headers
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    // Make sure token exists
    if (!token) {
      return next(new AppError("Not authorized to access this route", 401));
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Handle guest users
      if (decoded.isGuest) {
        // Create a guest user object for consistency
        req.user = {
          _id: decoded.id,
          id: decoded.id,
          fullName: decoded.name,
          mobile: decoded.mobile,
          isGuest: true,
          isServiceProvider: false,
          status: "active",
        };
        return next();
      }

      // Get regular user from token
      const user = await User.findById(decoded.id);

      if (!user) {
        return next(new AppError("User not found", 404));
      }

      if (user.status !== "active") {
        return next(new AppError("Your account has been suspended", 403));
      }

      req.user = user;
      next();
    } catch (err) {
      return next(new AppError("Not authorized to access this route", 401));
    }
  } catch (error) {
    next(error);
  }
};

// Grant access to specific roles
const authorize = (...roles) => {
  return (req, res, next) => {
    // For admin role check
    if (roles.includes("admin") && req.user?.email?.includes("@admin")) {
      return next();
    }

    // For service provider check
    if (roles.includes("provider") && req.user?.isServiceProvider) {
      return next();
    }

    return next(
      new AppError(`User role is not authorized to access this route`, 403)
    );
  };
};

// Check if user is service provider
const isServiceProvider = async (req, res, next) => {
  if (!req.user?.isServiceProvider) {
    return next(
      new AppError("You must be a service provider to access this route", 403)
    );
  }
  next();
};

// Check if user has verified Aadhar
const isAadharVerified = async (req, res, next) => {
  if (!req.user?.isAadharVerified) {
    return next(new AppError("Aadhar verification required", 403));
  }
  next();
};

module.exports = {
  protect,
  authorize,
  isServiceProvider,
  isAadharVerified,
};
