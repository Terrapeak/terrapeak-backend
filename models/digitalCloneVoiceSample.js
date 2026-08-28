import mongoose from "mongoose";

const DigitalCloneVoiceSampleSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    filename: { type: String, required: true, trim: true, maxlength: 240 },
    mimeType: { type: String, required: true, trim: true, maxlength: 100 },
    storagePublicId: { type: String, required: true, unique: true, index: true, select: false },
    bytes: { type: Number, required: true, min: 1 },
    durationSeconds: { type: Number, default: null, min: 0, max: 3600 },
    status: {
      type: String,
      enum: ["active", "deleting", "deleted"],
      default: "active",
      index: true,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

DigitalCloneVoiceSampleSchema.index({ companyId: 1, userId: 1, status: 1, createdAt: -1 });

export default mongoose.model("DigitalCloneVoiceSample", DigitalCloneVoiceSampleSchema);
