import mongoose from "mongoose";

const ContentStudioContentSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },

    summary: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },

    content: {
      type: String,
      required: true,
    },

    contentType: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    status: {
      type: String,
      enum: ["draft", "final", "archived"],
      default: "draft",
      index: true,
    },

    brief: {
      goal: {
        type: String,
        default: "",
        trim: true,
      },

      topic: {
        type: String,
        default: "",
        trim: true,
      },

      audience: {
        type: String,
        default: "",
        trim: true,
      },

      tone: {
        type: String,
        default: "",
        trim: true,
      },

      length: {
        type: String,
        default: "",
        trim: true,
      },

      keyPoints: {
        type: [String],
        default: [],
      },

      keywords: {
        type: [String],
        default: [],
      },

      callToAction: {
        type: String,
        default: "",
        trim: true,
      },
    },

    generationMetadata: {
      provider: {
        type: String,
        default: "gemini",
      },

      model: {
        type: String,
        default: "",
      },

      generatedAt: {
        type: Date,
        default: null,
      },

      generationId: {
        type: String,
        default: "",
        trim: true,
      },
    },

    imagePlacementMode: {
      type: String,
      enum: ["manual", "assisted", "automatic"],
      default: "manual",
    },

    images: {
      type: [
        {
          assetId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ContentStudioImageAsset",
            required: true,
          },
          position: {
            type: String,
            enum: ["cover", "after-heading", "after-paragraph", "inline", "manual"],
            default: "manual",
          },
          anchor: { type: String, default: "", maxlength: 500 },
          order: { type: Number, default: 0 },
          altText: { type: String, default: "", maxlength: 500 },
          caption: { type: String, default: "", maxlength: 1000 },
          approved: { type: Boolean, default: true },
        },
      ],
      default: [],
    },

    publishedContent: {
      type: String,
      default: "",
    },

    publishedAt: {
      type: Date,
      default: null,
      index: true,
    },

    publishedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    publishVersion: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastEditedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

ContentStudioContentSchema.index({
  companyId: 1,
  createdAt: -1,
});

ContentStudioContentSchema.index({
  companyId: 1,
  status: 1,
  updatedAt: -1,
});

ContentStudioContentSchema.index({
  companyId: 1,
  contentType: 1,
  updatedAt: -1,
});

export default mongoose.model(
  "ContentStudioContent",
  ContentStudioContentSchema,
);