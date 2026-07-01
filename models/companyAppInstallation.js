import mongoose from "mongoose";

const CompanyAppInstallationSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    appSlug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    enabled: {
      type: Boolean,
      default: true,
    },

    status: {
      type: String,
      enum: ["active", "disabled", "pending", "failed"],
      default: "active",
    },

    installedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    installedAt: {
      type: Date,
      default: Date.now,
    },

    plan: {
      type: String,
      enum: ["starter", "growth", "professional", "enterprise", "custom"],
      default: "starter",
    },

    billingStatus: {
      type: String,
      enum: ["trial", "active", "past_due", "cancelled", "manual"],
      default: "manual",
    },

    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

CompanyAppInstallationSchema.index(
  { companyId: 1, appSlug: 1 },
  { unique: true }
);

export default mongoose.model(
  "CompanyAppInstallation",
  CompanyAppInstallationSchema
);