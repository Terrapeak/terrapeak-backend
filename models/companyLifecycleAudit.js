import mongoose from "mongoose";

const CompanyLifecycleAuditSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      enum: ["company_archived", "company_restored"],
      required: true,
      index: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    sourceOrganizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },
    targetOrganizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    actorRole: { type: String, required: true, trim: true },
    reason: { type: String, trim: true, maxlength: 500, default: "" },
    before: { type: mongoose.Schema.Types.Mixed, required: true },
    after: { type: mongoose.Schema.Types.Mixed, required: true },
    outcome: {
      type: String,
      enum: ["succeeded"],
      default: "succeeded",
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export default mongoose.model("CompanyLifecycleAudit", CompanyLifecycleAuditSchema);
