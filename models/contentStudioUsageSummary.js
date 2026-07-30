import mongoose from "mongoose";

const ContentStudioUsageSummarySchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, unique: true, index: true },
  storageBytes: { type: Number, default: 0, min: 0 },
  imageCount: { type: Number, default: 0, min: 0 },
  generatedImagesThisMonth: { type: Number, default: 0, min: 0 },
  uploadedImagesThisMonth: { type: Number, default: 0, min: 0 },
  reservedStorageBytes: { type: Number, default: 0, min: 0 },
  reservedImageCount: { type: Number, default: 0, min: 0 },
  reservedGeneratedImages: { type: Number, default: 0, min: 0 },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
}, { timestamps: true });

export default mongoose.model("ContentStudioUsageSummary", ContentStudioUsageSummarySchema);
