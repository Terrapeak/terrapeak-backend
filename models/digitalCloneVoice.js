import mongoose from "mongoose";

const DigitalCloneVoiceSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: String, default: "", trim: true, maxlength: 80, select: false },
    providerVoiceId: { type: String, default: "", trim: true, maxlength: 500, select: false },
    status: {
      type: String,
      enum: ["not_started", "samples_uploaded", "processing", "verification_required", "ready", "failed", "revoked"],
      default: "not_started",
      index: true,
    },
    language: { type: String, default: "en", trim: true, maxlength: 20 },
    displayName: { type: String, default: "My Voice", trim: true, maxlength: 120 },
    trainingSampleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneVoiceSample" }],
    activeSampleCount: { type: Number, default: 0, min: 0, max: 10 },
    voiceSettings: {
      speakingPace: {
        type: String,
        enum: ["slow", "moderate", "fast"],
        default: "moderate",
      },
      expressiveness: { type: Number, min: 1, max: 5, default: 3 },
    },
    consent: {
      voiceOwnershipOrAuthorization: { type: Boolean, default: false },
      processingAuthorized: { type: Boolean, default: false },
      generatedSpeechAuthorized: { type: Boolean, default: false },
      revocationUnderstood: { type: Boolean, default: false },
      version: { type: String, default: "1.0", maxlength: 30 },
      acceptedAt: { type: Date, default: null },
      acceptedIp: { type: String, default: "", trim: true, maxlength: 200 },
      revokedAt: { type: Date, default: null },
    },
    approvedAt: { type: Date, default: null },
    approvedPreviewId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneVoicePreview", default: null },
    revokedAt: { type: Date, default: null },
    creationStartedAt: { type: Date, default: null },
    providerDeletionStatus: {
      type: String,
      enum: ["not_requested", "pending", "deleted", "failed"],
      default: "not_requested",
      select: false,
    },
    pendingProviderDeletionId: { type: String, default: "", trim: true, maxlength: 500, select: false },
  },
  { timestamps: true },
);

DigitalCloneVoiceSchema.index({ companyId: 1, userId: 1 }, { unique: true });
DigitalCloneVoiceSchema.index({ companyId: 1, userId: 1, status: 1 });

export default mongoose.model("DigitalCloneVoice", DigitalCloneVoiceSchema);
