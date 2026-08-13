import mongoose from "mongoose";

const DigitalCloneProfileSchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },
    displayName: { type: String, default: "", trim: true, maxlength: 200 },
    jobTitle: { type: String, default: "", trim: true, maxlength: 200 },
    bio: { type: String, default: "", trim: true, maxlength: 5000 },
    expertise: { type: [String], default: [] },
    topics: { type: [String], default: [] },
    targetAudience: { type: String, default: "", trim: true, maxlength: 3000 },
    languages: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["draft", "consented", "setup"],
      default: "draft",
      index: true,
    },
    consent: {
      identityConfirmed: { type: Boolean, default: false },
      voiceRightsConfirmed: { type: Boolean, default: false },
      mediaRightsConfirmed: { type: Boolean, default: false },
      aiRepresentationConsent: { type: Boolean, default: false },
      version: { type: String, default: "1.0" },
      acceptedAt: { type: Date, default: null },
      acceptedIp: { type: String, default: "", trim: true },
    },
  },
  { timestamps: true },
);

DigitalCloneProfileSchema.index({ companyId: 1, userId: 1 }, { unique: true });

export default mongoose.model("DigitalCloneProfile", DigitalCloneProfileSchema);
