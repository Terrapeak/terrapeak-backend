import mongoose from "mongoose";

const ContentStudioBrandSettingsSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
      index: true,
    },

    updatedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    brandName: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },

    websiteUrl: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },

    brandDescription: {
      type: String,
      default: "",
      trim: true,
      maxlength: 5000,
    },

    targetAudience: {
      type: String,
      default: "",
      trim: true,
      maxlength: 5000,
    },

    defaultTone: {
      type: String,
      default: "professional",
      trim: true,
      lowercase: true,
    },

    voiceTraits: {
      type: [String],
      default: [],
    },

    productsAndServices: {
      type: [String],
      default: [],
    },

    preferredKeywords: {
      type: [String],
      default: [],
    },

    bannedWords: {
      type: [String],
      default: [],
    },

    writingRules: {
      type: [String],
      default: [],
    },

    defaultCallToAction: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },

    additionalContext: {
      type: String,
      default: "",
      trim: true,
      maxlength: 10000,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model(
  "ContentStudioBrandSettings",
  ContentStudioBrandSettingsSchema,
);