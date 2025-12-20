const jwt = require("jsonwebtoken");
const { User } = require("../models");
const Admin = require("../models/Admin.model");
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

      // Handle admin users
      if (decoded.isAdmin) {
        const admin = await Admin.findById(decoded.id);
        
        if (!admin) {
          return next(new AppError("Admin not found", 404));
        }

        if (!admin.isActive) {
          console.log('🔐 AUTH DEBUG - Admin account deactivated:', admin.email);
          return next(new AppError("Admin account is deactivated", 403));
        }

        console.log('🔐 AUTH DEBUG - Admin authenticated:', { email: admin.email, id: admin._id, role: admin.role });
        req.user = {
          ...admin.toObject(),
          isAdmin: true,
          id: admin._id
        };
        return next();
      }

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

// Check if user is admin
const adminOnly = async (req, res, next) => {
  console.log('🔧 ADMIN CHECK - User:', {
    email: req.user?.email,
    id: req.user?._id?.toString() || req.user?.id,
    isAdmin: req.user?.isAdmin,
    role: req.user?.role
  });

  // Check if user is authenticated admin
  if (!req.user?.isAdmin) {
    console.log('🔧 ADMIN CHECK - Access denied: Not an admin');
    return next(new AppError("Admin access required", 403));
  }

  console.log('🔧 ADMIN CHECK - Access granted');
  next();
};

// Guest-only authentication middleware
const guestAuth = async (req, res, next) => {
  try {
    let token;

    // Check for token in headers
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return next(new AppError("Not authorized to access this route", 401));
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Only allow guest users
      if (!decoded.isGuest) {
        return next(new AppError("Guest access required", 403));
      }

      // Get guest from database
      const { Guest } = require("../models");
      const guest = await Guest.findById(decoded.id);

      if (!guest) {
        return next(new AppError("Guest not found", 404));
      }

      if (guest.status !== "active") {
        return next(new AppError("Your account has been suspended", 403));
      }

      // Update last active
      guest.lastActive = new Date();
      await guest.save();

      req.user = {
        ...guest.toObject(),
        id: guest._id,
        isGuest: true
      };
      
      next();
    } catch (err) {
      return next(new AppError("Not authorized to access this route", 401));
    }
  } catch (error) {
    next(error);
  }
};

module.exports = {
  protect,
  authorize,
  isServiceProvider,
  isAadharVerified,
  adminOnly,
  guestAuth,
};
