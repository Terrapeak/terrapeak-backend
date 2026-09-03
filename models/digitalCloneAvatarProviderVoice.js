import mongoose from "mongoose";

const DigitalCloneAvatarProviderVoiceSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  provider: { type: String, required: true, trim: true, maxlength: 80, select: false },
  providerKeyHash: { type: String, required: true, maxlength: 64, select: false },
  providerVoiceRef: { type: String, required: true, maxlength: 500, select: false },
  providerPreviewUrl: { type: String, default: "", maxlength: 2000, select: false },
  displayName: { type: String, required: true, trim: true, maxlength: 200 },
  language: { type: String, default: "Unknown", trim: true, maxlength: 100 },
  gender: { type: String, enum: ["male", "female", "neutral", "unknown"], default: "unknown" },
  voiceType: { type: String, enum: ["public", "private", "unknown"], default: "unknown" },
  previewAvailable: { type: Boolean, default: false },
  providerReady: { type: Boolean, default: false, index: true },
  status: { type: String, enum: ["discovered", "selected", "unavailable", "revoked"], default: "discovered", index: true },
  lastDiscoveredAt: { type: Date, required: true, default: Date.now },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });

DigitalCloneAvatarProviderVoiceSchema.index({ companyId: 1, userId: 1, providerKeyHash: 1 }, { unique: true });
DigitalCloneAvatarProviderVoiceSchema.index({ companyId: 1, userId: 1, status: 1, createdAt: -1 });
DigitalCloneAvatarProviderVoiceSchema.index(
  { companyId: 1, userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "selected" } },
);

export default mongoose.model("DigitalCloneAvatarProviderVoice", DigitalCloneAvatarProviderVoiceSchema);
