import mongoose from "mongoose";

const DigitalCloneTestCloneSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  sourceType: { type: String, enum: ["new-prompt", "approved-draft"], required: true },
  sourceDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneGeneration", default: null },
  originalPrompt: { type: String, default: "", maxlength: 1000 },
  scriptText: { type: String, required: true, maxlength: 1200 },
  scriptHash: { type: String, required: true, maxlength: 64 },
  scriptVersion: { type: Number, required: true, min: 1, default: 1 },
  scriptApprovedHash: { type: String, default: "", maxlength: 64 },
  scriptApprovedAt: { type: Date, default: null },
  scriptApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  settings: {
    aspectRatio: { type: String, enum: ["9:16", "16:9"], default: "9:16" },
    resolution: { type: String, enum: ["720p", "1080p"], default: "720p" },
    captions: { type: Boolean, default: false },
    background: { type: String, enum: ["default", "light", "dark"], default: "default" },
  },
  avatarId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneAvatarCandidate", default: null },
  providerVoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneAvatarProviderVoice", default: null },
  avatarValidationVideoId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneAvatarVideo", default: null },
  avatarVideoId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneAvatarVideo", default: null },
  generatedScriptHash: { type: String, default: "", maxlength: 64 },
  status: {
    type: String,
    enum: ["script-draft", "script-approved", "queued", "processing", "completed", "failed", "approved", "rejected", "archived"],
    default: "script-draft",
    index: true,
  },
  failureCode: { type: String, default: "", maxlength: 120 },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rejectedAt: { type: Date, default: null },
}, { timestamps: true });

DigitalCloneTestCloneSchema.index({ companyId: 1, userId: 1, createdAt: -1 });

export default mongoose.model("DigitalCloneTestClone", DigitalCloneTestCloneSchema);
