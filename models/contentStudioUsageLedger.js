import mongoose from "mongoose";

const ContentStudioUsageLedgerSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  requestId: { type: String, required: true, trim: true },
  action: { type: String, enum: ["upload", "import-url", "import-drive", "generate"], required: true },
  status: { type: String, enum: ["reserved", "committed", "rolled-back"], required: true, index: true },
  storageBytes: { type: Number, default: 0, min: 0 },
  imageCount: { type: Number, default: 0, min: 0 },
  generationCount: { type: Number, default: 0, min: 0 },
  failureCode: { type: String, default: "" },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

ContentStudioUsageLedgerSchema.index({ companyId: 1, requestId: 1, action: 1 }, { unique: true });
export default mongoose.model("ContentStudioUsageLedger", ContentStudioUsageLedgerSchema);
