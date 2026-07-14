import mongoose from "mongoose";

const contractSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    plan: {
      type: String,
      enum: [
        "starter",
        "growth",
        "professional",
        "enterprise",
      ],
      default: "starter",
    },

    status: {
      type: String,
      enum: [
        "trial",
        "active",
        "expired",
        "cancelled",
      ],
      default: "trial",
    },

    startDate: {
      type: Date,
      required: true,
    },

    endDate: {
      type: Date,
      required: true,
    },

    autoRenew: {
      type: Boolean,
      default: false,
    },

    billingType: {
      type: String,
      enum: [
        "manual",
        "invoice",
        "stripe",
      ],
      default: "manual",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    convertedFromTrial: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  "Contract",
  contractSchema
);