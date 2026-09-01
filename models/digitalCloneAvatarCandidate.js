import mongoose from "mongoose";

const DigitalCloneAvatarCandidateSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  provider: { type: String, required: true, trim: true, maxlength: 80, select: false },
  providerKeyHash: { type: String, required: true, maxlength: 64, select: false },
  providerAvatarGroupRef: { type: String, required: true, maxlength: 500, select: false },
  providerAvatarLookRef: { type: String, required: true, maxlength: 500, select: false },
  providerDefaultVoiceRef: { type: String, default: "", maxlength: 500, select: false },
  previewImageUrl: { type: String, default: "", maxlength: 2000, select: false },
  displayName: { type: String, required: true, trim: true, maxlength: 200 },
  avatarType: { type: String, enum: ["photo-avatar", "digital-twin", "studio-avatar", "unknown"], default: "unknown" },
  orientation: { type: String, enum: ["portrait", "landscape", "square", "unknown"], default: "unknown" },
  supportedCapabilities: { type: [String], default: [] },
  providerReady: { type: Boolean, default: false, index: true },
  status: { type: String, enum: ["discovered", "selected", "unavailable", "revoked"], default: "discovered", index: true },
  lastDiscoveredAt: { type: Date, required: true, default: Date.now },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });

DigitalCloneAvatarCandidateSchema.index({ companyId: 1, userId: 1, providerKeyHash: 1 }, { unique: true });
DigitalCloneAvatarCandidateSchema.index({ companyId: 1, userId: 1, status: 1, createdAt: -1 });
DigitalCloneAvatarCandidateSchema.index(
  { companyId: 1, userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "selected" } },
);

export default mongoose.model("DigitalCloneAvatarCandidate", DigitalCloneAvatarCandidateSchema);
