const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const ConsultationSchema = new mongoose.Schema(
  {
    consultationId: {
      type: String,
      unique: true,
      default: () => `CON-${uuidv4().substring(0, 8).toUpperCase()}`,
    },
    user: {
      type: mongoose.Schema.Types.Mixed, // Allow both ObjectId and String for guest users
      required: true,
    },
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["chat", "audio", "video"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "ongoing",
        "completed",
        "cancelled",
        "missed",
        "no_answer",
      ],
      default: "pending",
    },
    startTime: Date,
    endTime: Date,
    duration: {
      type: Number,
      default: 0,
    },
    rate: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      default: 0,
    },
    // Real-time billing fields
    billingStarted: {
      type: Boolean,
      default: false,
    },
    lastBillingTime: Date,
    // Call acceptance tracking
    clientAccepted: {
      type: Boolean,
      default: false,
    },
    providerAccepted: {
      type: Boolean,
      default: false,
    },
    clientAcceptedAt: Date,
    providerAcceptedAt: Date,
    bothSidesAcceptedAt: Date, // When both sides have accepted - this is when billing starts
    endReason: {
      type: String,
      enum: [
        "manual",
        "insufficient_funds",
        "provider_ended",
        "system_error",
        "no_answer",
      ],
      default: "manual",
    },
    userType: {
      type: String,
      enum: ["User", "Guest"],
      default: "User",
    },
    messages: [
      {
        sender: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
        },
        senderName: {
          type: String,
          required: true,
        },
        senderAvatar: {
          type: String,
          default: null,
        },
        message: {
          type: String,
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
        type: {
          type: String,
          enum: ["text", "image", "file", "audio", "video"],
          default: "text",
        },
        file: {
          filename: String,
          originalName: String,
          mimetype: String,
          size: Number,
          path: String,
        },
        status: {
          type: String,
          enum: ["sent", "delivered", "read"],
          default: "delivered",
        },
        readBy: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
        ],
      },
    ],
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
    rating: {
      stars: {
        type: Number,
        min: 1,
        max: 5,
      },
      review: String,
      tags: [String],
    },
    invoice: String,

    // Provider-to-Provider consultation fields
    isProviderToProvider: {
      type: Boolean,
      default: false,
    },
    bookingProviderIsClient: {
      type: Boolean,
      default: false,
    },
    participantRoles: {
      bookingProvider: {
        type: String,
        enum: ["client", "provider"],
        default: "client",
      },
      bookedProvider: {
        type: String,
        enum: ["client", "provider"],
        default: "provider",
      },
    },

    // First Minute Free Trial fields
    isFirstMinuteFree: {
      type: Boolean,
      default: false,
    },
    freeMinuteUsed: {
      type: Boolean,
      default: false,
    },
    billingStartsAt: Date, // When billing actually starts (startTime + 1 minute if first minute free)

    // NEW: First Time Free Trial System
    isFirstTimeFreeTrial: {
      type: Boolean,
      default: false,
    },
    freeTrialUsed: {
      type: Boolean,
      default: false,
    },
    entireCallFree: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes (consultationId unique index handled by schema)
ConsultationSchema.index({ user: 1, status: 1 });
ConsultationSchema.index({ provider: 1, status: 1 });
ConsultationSchema.index({ createdAt: -1 });

// Helper function for precise money calculation to avoid floating point issues
const preciseMoneyCalculation = (amount1, amount2, operation) => {
  // Convert to cents to avoid floating point issues
  const cents1 = Math.round(amount1 * 100);
  const cents2 = Math.round(amount2 * 100);

  let resultCents;
  switch (operation) {
    case "add":
      resultCents = cents1 + cents2;
      break;
    case "subtract":
      resultCents = cents1 - cents2;
      break;
    case "multiply":
      resultCents = Math.round((cents1 * cents2) / 100);
      break;
    case "divide":
      resultCents = Math.round((cents1 / cents2) * 100);
      break;
    default:
      throw new Error("Invalid operation");
  }

  // Convert back to rupees with exactly 2 decimal places
  return Math.round(resultCents) / 100;
};

// Calculate total amount based on duration and rate - FIXED FOR PRECISION
ConsultationSchema.pre("save", function (next) {
  if (this.duration && this.rate) {
    // CRITICAL FIX: Use precise calculation instead of direct multiplication
    this.totalAmount = preciseMoneyCalculation(
      this.duration,
      this.rate,
      "multiply"
    );

    console.log("💰 CONSULTATION MODEL - PRECISE CALCULATION:", {
      duration: this.duration,
      rate: this.rate,
      totalAmount: this.totalAmount,
      consultationId: this._id,
      note: "Using precise money calculation to avoid floating point issues",
    });
  }
  next();
});

module.exports = mongoose.model("Consultation", ConsultationSchema);
