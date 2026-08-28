import mongoose from "mongoose";

const DigitalCloneVoicePreviewSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    voiceId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalCloneVoice", required: true, index: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    mimeType: { type: String, required: true, trim: true, maxlength: 100 },
    storagePublicId: { type: String, required: true, unique: true, index: true, select: false },
    bytes: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["active", "revoked", "deleted"],
      default: "active",
      index: true,
    },
    approvedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

DigitalCloneVoicePreviewSchema.index({ companyId: 1, userId: 1, createdAt: -1 });

export default mongoose.model("DigitalCloneVoicePreview", DigitalCloneVoicePreviewSchema);
