const mongoose = require("mongoose");
const { preciseMoneyCalculation } = require("./Consultation.model");

const LiveStreamSchema = new mongoose.Schema(
  {
    streamer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      maxlength: 200,
      default: "Live Stream",
    },
    description: {
      type: String,
      maxlength: 2000,
    },
    thumbnail: String,
    isActive: {
      type: Boolean,
      default: false,
    },
    startedAt: Date,
    endedAt: Date,
    viewers: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        joinedAt: Date,
        webrtcConnectedAt: Date,
        leftAt: Date,
        duration: {
          type: Number, // in seconds
          default: 0,
        },
        amountToPay: {
          type: Number,
          default: 0,
        },
        isPaid: {
          type: Boolean,
          default: false,
        },
        lastBillingTime: Date,
        billingStarted: {
          type: Boolean,
          default: false,
        },
      },
    ],
    totalViewers: {
      type: Number,
      default: 0,
    },
    maxConcurrentViewers: {
      type: Number,
      default: 0,
    },
    totalEarnings: {
      type: Number,
      default: 0,
    },
    ratePerMinute: {
      type: Number,
      default: 0,
    },
    likes: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

LiveStreamSchema.pre("save", function (next) {
  // Calculate total concurrent viewers whenever viewers array changes
  this.totalViewers = this.viewers.length;
  
  // Calculate max concurrent viewers
  if (this.viewers.length > this.maxConcurrentViewers) {
    this.maxConcurrentViewers = this.viewers.length;
  }
  
  next();
});

LiveStreamSchema.methods.calculateViewerAmount = function (viewerId, ratePerMinute) {
  const viewer = this.viewers.find(v => v.user.toString() === viewerId.toString());
  if (!viewer) return 0;

  const joinTime = viewer.joinedAt;
  const endTime = viewer.leftAt || new Date();
  const durationInSeconds = Math.floor((endTime - joinTime) / 1000);
  const durationInMinutes = Math.ceil(durationInSeconds / 60);
  
  const amount = preciseMoneyCalculation(durationInMinutes, ratePerMinute, "multiply");
  
  return {
    durationInSeconds,
    durationInMinutes,
    amount,
  };
};

module.exports = mongoose.model("LiveStream", LiveStreamSchema);
