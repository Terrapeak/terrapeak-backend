import mongoose from "mongoose";

const ContentStudioImageAssetSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    source: {
      type: String,
      enum: ["local", "url", "google-drive", "generated", "stock"],
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["cloudinary", "google-drive", "google-imagen", "google-gemini-image", "shutterstock", "custom"],
      required: true,
    },
    externalId: { type: String, default: "", trim: true },
    filename: { type: String, required: true, trim: true, maxlength: 300 },
    mimeType: { type: String, required: true, trim: true },
    url: { type: String, required: true },
    storagePublicId: { type: String, required: true, index: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    bytes: { type: Number, default: null },
    altText: { type: String, default: "", trim: true, maxlength: 500 },
    caption: { type: String, default: "", trim: true, maxlength: 1000 },
    prompt: { type: String, default: "", trim: true, maxlength: 4000 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["temporary", "active", "deleted"],
      default: "active",
      index: true,
    },
    referenceCount: { type: Number, default: 0, min: 0 },
    deletedAt: { type: Date, default: null },
    deletedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    purgeAfter: { type: Date, default: null },
  },
  { timestamps: true },
);

ContentStudioImageAssetSchema.index({ companyId: 1, createdAt: -1 });
ContentStudioImageAssetSchema.index({ companyId: 1, source: 1, createdAt: -1 });

export default mongoose.model("ContentStudioImageAsset", ContentStudioImageAssetSchema);
