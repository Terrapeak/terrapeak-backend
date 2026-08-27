import mongoose from "mongoose";

const DigitalCloneGenerationSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    contentType: {
      type: String,
      required: true,
      enum: ["linkedin-post", "short-video-script", "article-outline", "social-caption", "email", "thought-leadership-post"],
      index: true,
    },
    topic: { type: String, required: true, trim: true, maxlength: 1000 },
    goal: { type: String, default: "", trim: true, maxlength: 1000 },
    tone: { type: String, default: "", trim: true, maxlength: 100 },
    length: { type: String, required: true, enum: ["short", "medium", "long"] },
    additionalInstructions: { type: String, default: "", trim: true, maxlength: 3000 },
    originalGeneratedText: { type: String, required: true, maxlength: 50000 },
    currentText: { type: String, required: true, maxlength: 50000 },
    finalApprovedText: { type: String, default: "", maxlength: 50000 },
    structuredOutput: { type: mongoose.Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: ["draft", "edited", "approved", "rejected", "archived"],
      default: "draft",
      index: true,
    },
    providerMetadata: {
      model: { type: String, default: "", maxlength: 200 },
      usage: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

DigitalCloneGenerationSchema.index({ companyId: 1, userId: 1, createdAt: -1 });

export default mongoose.model("DigitalCloneGeneration", DigitalCloneGenerationSchema);
