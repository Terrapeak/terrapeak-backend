import mongoose from "mongoose";

const DigitalCloneAvatarVideoSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  avatarId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneAvatarCandidate", required: true, index: true },
  providerVoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneAvatarProviderVoice", default: null, index: true },
  sourceDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneGeneration", default: null },
  sourceType: { type: String, enum: ["approved-draft", "manual-test"], required: true },
  scriptSnapshot: { type: String, required: true, maxlength: 1200 },
  aspectRatio: { type: String, enum: ["9:16", "16:9"], default: "9:16" },
  resolution: { type: String, enum: ["720p", "1080p"], default: "720p" },
  captions: { type: Boolean, default: false },
  background: { type: String, enum: ["default", "light", "dark"], default: "default" },
  status: { type: String, enum: ["queued", "processing", "completed", "failed", "approved", "rejected", "archived"], default: "queued", index: true },
  provider: { type: String, default: "", maxlength: 80, select: false },
  providerJobRef: { type: String, default: "", maxlength: 500, select: false },
  providerResultUrl: { type: String, default: "", maxlength: 2000, select: false },
  storagePublicId: { type: String, default: "", maxlength: 1000, select: false },
  mimeType: { type: String, default: "video/mp4", maxlength: 100 },
  bytes: { type: Number, default: 0, min: 0 },
  durationSeconds: { type: Number, default: null, min: 0 },
  failureCode: { type: String, default: "", maxlength: 120 },
  dedupeKey: { type: String, required: true, maxlength: 64, select: false },
  activeDedupeKey: { type: String, default: null, maxlength: 64, select: false },
  completedAt: { type: Date, default: null },
  approvedAt: { type: Date, default: null },
  rejectedAt: { type: Date, default: null },
}, { timestamps: true });

DigitalCloneAvatarVideoSchema.index({ companyId: 1, userId: 1, createdAt: -1 });
DigitalCloneAvatarVideoSchema.index(
  { companyId: 1, userId: 1, activeDedupeKey: 1 },
  { unique: true, partialFilterExpression: { activeDedupeKey: { $type: "string" } } },
);
DigitalCloneAvatarVideoSchema.index(
  { companyId: 1, userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "approved" } },
);

export default mongoose.model("DigitalCloneAvatarVideo", DigitalCloneAvatarVideoSchema);
