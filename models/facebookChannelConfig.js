import mongoose from "mongoose";

const FacebookPageOptionSchema = new mongoose.Schema(
  {
    pageId: {
      type: String,
      required: true,
      trim: true,
    },
    pageName: {
      type: String,
      required: true,
      trim: true,
    },
    pageAccessTokenEncrypted: {
      type: String,
      required: true,
      select: false,
    },
  },
  {
    _id: false,
  }
);

const FacebookChannelConfigSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
      index: true,
    },

    appInstallationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyAppInstallation",
      default: null,
    },

    connectionStatus: {
      type: String,
      enum: ["not_connected", "connecting", "connected", "disconnected", "error"],
      default: "not_connected",
    },

    metaUserId: {
      type: String,
      default: "",
      trim: true,
    },

    pageId: {
      type: String,
      default: "",
      trim: true,
    },

    pageName: {
      type: String,
      default: "",
      trim: true,
    },

    pageAccessTokenEncrypted: {
      type: String,
      default: "",
      select: false,
    },

    availablePages: {
      type: [FacebookPageOptionSchema],
      default: [],
    },

    grantedPermissions: {
      type: [String],
      default: [],
    },

    webhookSubscribed: {
      type: Boolean,
      default: false,
    },

    connectedAt: {
      type: Date,
      default: null,
    },

    disconnectedAt: {
      type: Date,
      default: null,
    },

    lastError: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  "FacebookChannelConfig",
  FacebookChannelConfigSchema
);
