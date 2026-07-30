import mongoose from "mongoose";

const CompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    displayName: { type: String, default: "" },
    referencePrefix: { type: String, default: "BOT" },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    reservationBusinessSlug: { type: String, default: "" },
    country: { type: String, default: "PH", uppercase: true, trim: true },
    address: { type: String, default: "", trim: true },
    website: { type: String, default: "", trim: true },
    email: { type: String, default: "", lowercase: true, trim: true },
    phone: { type: String, default: "", trim: true },
    installedApps: { type: [String], default: ["ai-assistant"] },
    plan: {
      type: String,
      enum: ["starter", "growth", "professional", "enterprise"],
      default: "starter",
    },
    billingSource: {
      type: String,
      enum: ["company", "organization"],
      default: "company",
      index: true,
    },
    billing: {
      status: {
        type: String,
        enum: ["not_configured", "trial", "active", "past_due", "cancelled", "manual"],
        default: "not_configured",
      },
      trialEndDate: { type: Date, default: null },
      renewalDate: { type: Date, default: null },
      contractEndDate: { type: Date, default: null },
      creditsRemaining: { type: Number, default: null },
      paymentStatus: {
        type: String,
        enum: ["not_configured", "paid", "unpaid", "past_due", "failed", "manual"],
        default: "not_configured",
      },
    },
    contentStudioAiConfig: {
      provider: { type: String, default: "Gemini" },
      geminiKey: { type: String, default: "" },
      geminiKeyEncrypted: {
        ciphertext: { type: String, default: "" },
        iv: { type: String, default: "" },
        authTag: { type: String, default: "" },
        keyVersion: { type: Number, default: 1 },
        lastFour: { type: String, default: "" },
      },
      model: { type: String, default: "gemini-2.5-flash" },
      fallbackModel: { type: String, default: "gemini-2.5-flash-lite" },
      imageGeminiKey: { type: String, default: "" },
      imageGeminiKeyEncrypted: {
        ciphertext: { type: String, default: "" },
        iv: { type: String, default: "" },
        authTag: { type: String, default: "" },
        keyVersion: { type: Number, default: 1 },
        lastFour: { type: String, default: "" },
      },
      imageModel: { type: String, default: "gemini-2.5-flash-image" },
      updatedAt: { type: Date, default: null },
      credentialMigration: {
        migrationId: { type: String, default: "" },
        appliedAt: { type: Date, default: null },
        verifiedAt: { type: Date, default: null },
        textPlainFingerprint: { type: String, default: "" },
        imagePlainFingerprint: { type: String, default: "" },
      },
    },
    maxUsers: { type: Number, default: 1 },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    isActive: { type: Boolean, default: true },
    isPlatformWorkspace: { type: Boolean, default: false },
    activityEvents: {
      type: [
        {
          eventType: {
            type: String,
            enum: ["installed", "uninstalled", "enabled", "disabled", "updated"],
            required: true,
          },
          title: { type: String, required: true },
          appSlug: { type: String, required: true, lowercase: true, trim: true },
          appName: { type: String, default: "" },
          actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          actorName: { type: String, default: "" },
          actorEmail: { type: String, default: "" },
          createdAt: { type: Date, default: Date.now },
          metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

CompanySchema.index({ organizationId: 1, billingSource: 1 });

export default mongoose.model("Company", CompanySchema);
