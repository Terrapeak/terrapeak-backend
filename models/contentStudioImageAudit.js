import mongoose from "mongoose";

const ContentStudioImageAuditSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    imageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContentStudioImageAsset",
      default: null,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        "image.uploaded",
        "image.imported.url",
        "image.imported.drive",
        "image.generated",
        "image.attached",
        "image.detached",
        "image.deletion_blocked",
        "image.deleted",
        "image.access_denied",
        "image.generation_failed",
      ],
      required: true,
      index: true,
    },
    source: { type: String, default: "", trim: true },
    provider: { type: String, default: "", trim: true },
    fileSize: { type: Number, default: null },
    model: { type: String, default: "", trim: true },
    secureMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

ContentStudioImageAuditSchema.index({ companyId: 1, createdAt: -1 });
ContentStudioImageAuditSchema.index({ imageId: 1, createdAt: -1 });

export default mongoose.model(
  "ContentStudioImageAudit",
  ContentStudioImageAuditSchema,
);
