import mongoose from "mongoose";

const DigitalCloneVisualAssetSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    filename: { type: String, required: true, trim: true, maxlength: 300 },
    mimeType: { type: String, required: true, trim: true },
    storagePublicId: { type: String, required: true, unique: true, index: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    bytes: { type: Number, default: null },
    role: {
      type: String,
      enum: ["reference", "primary", "look-reference"],
      default: "reference",
      index: true,
    },
    primaryScopeKey: {
      type: String,
      default: undefined,
      select: false,
      maxlength: 64,
    },
    lookName: { type: String, default: "", trim: true, maxlength: 120 },
    notes: { type: String, default: "", trim: true, maxlength: 1000 },
    approvedForCloneUse: { type: Boolean, default: false, index: true },
    status: {
      type: String,
      enum: ["active", "revoked", "deleted"],
      default: "active",
      index: true,
    },
    revokedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

DigitalCloneVisualAssetSchema.index({ companyId: 1, userId: 1, createdAt: -1 });
DigitalCloneVisualAssetSchema.index({
  companyId: 1,
  userId: 1,
  status: 1,
  approvedForCloneUse: 1,
});
DigitalCloneVisualAssetSchema.index(
  { primaryScopeKey: 1 },
  { unique: true, sparse: true, name: "unique_active_primary_per_clone" },
);

export default mongoose.model("DigitalCloneVisualAsset", DigitalCloneVisualAssetSchema);
