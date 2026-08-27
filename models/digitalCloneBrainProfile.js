import mongoose from "mongoose";

const viewpointSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true, trim: true, maxlength: 200 },
    position: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { _id: false },
);

const storySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    summary: { type: String, required: true, trim: true, maxlength: 3000 },
    tags: { type: [String], default: [] },
  },
  { _id: false },
);

const DigitalCloneBrainProfileSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    expertiseSummary: { type: String, default: "", trim: true, maxlength: 5000 },
    expertiseAreas: { type: [String], default: [] },
    industries: { type: [String], default: [] },
    markets: { type: [String], default: [] },
    traits: { type: [String], default: [] },
    formality: { type: Number, min: 1, max: 5, default: null },
    detailLevel: { type: Number, min: 1, max: 5, default: null },
    energy: { type: Number, min: 1, max: 5, default: null },
    storytelling: { type: Number, min: 1, max: 5, default: null },
    technicality: { type: Number, min: 1, max: 5, default: null },
    communicationDescription: { type: String, default: "", trim: true, maxlength: 5000 },
    speakingPace: {
      type: String,
      enum: ["", "slow", "moderate", "fast"],
      default: "",
    },
    preferredPhrases: { type: [String], default: [] },
    avoidedPhrases: { type: [String], default: [] },
    writingRules: { type: [String], default: [] },
    viewpoints: { type: [viewpointSchema], default: [] },
    stories: { type: [storySchema], default: [] },
    avoidTopics: { type: [String], default: [] },
    prohibitedClaims: { type: [String], default: [] },
    additionalInstructions: { type: String, default: "", trim: true, maxlength: 5000 },
    status: {
      type: String,
      enum: ["draft", "ready"],
      default: "draft",
      index: true,
    },
  },
  { timestamps: true },
);

DigitalCloneBrainProfileSchema.index({ companyId: 1, userId: 1 }, { unique: true });

export default mongoose.model("DigitalCloneBrainProfile", DigitalCloneBrainProfileSchema);
