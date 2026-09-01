import mongoose from "mongoose";

const DigitalCloneAvatarSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  provider: { type: String, default: "", trim: true, maxlength: 80, select: false },
  status: { type: String, enum: ["not_started", "selected", "ready", "failed", "revoked"], default: "not_started", index: true },
  selectedAvatarId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneAvatarCandidate", default: null },
  selectedProviderVoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneAvatarProviderVoice", default: null },
  preferredOrientation: { type: String, enum: ["9:16", "16:9"], default: "9:16" },
  consent: {
    appearanceOwnershipOrAuthorization: { type: Boolean, default: false },
    avatarGenerationAuthorized: { type: Boolean, default: false },
    providerProcessingAuthorized: { type: Boolean, default: false },
    revocationUnderstood: { type: Boolean, default: false },
    version: { type: String, default: "1.0", maxlength: 30 },
    acceptedAt: { type: Date, default: null },
    acceptedIp: { type: String, default: "", trim: true, maxlength: 200 },
    revokedAt: { type: Date, default: null },
  },
  approvedAt: { type: Date, default: null },
  approvedVideoId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneAvatarVideo", default: null },
  revokedAt: { type: Date, default: null },
  lastErrorCode: { type: String, default: "", trim: true, maxlength: 120 },
}, { timestamps: true });

DigitalCloneAvatarSchema.index({ companyId: 1, userId: 1 }, { unique: true });

export default mongoose.model("DigitalCloneAvatar", DigitalCloneAvatarSchema);
