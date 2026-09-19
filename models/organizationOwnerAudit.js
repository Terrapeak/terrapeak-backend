import mongoose from "mongoose";

const OrganizationOwnerAuditSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      enum: [
        "organization_owner_details_updated",
        "organization_owner_password_reset_sent",
        "organization_owner_transferred",
      ],
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    actorPlatformRole: { type: String, required: true, trim: true },
    affectedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    formerOwnerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    newOwnerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    formerOwnerAction: {
      type: String,
      enum: ["admin", "member", "remove", null],
      default: null,
    },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export default mongoose.model(
  "OrganizationOwnerAudit",
  OrganizationOwnerAuditSchema,
);
