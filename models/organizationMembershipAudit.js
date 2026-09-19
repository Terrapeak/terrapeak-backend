import mongoose from "mongoose";

const OrganizationMembershipAuditSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      enum: [
        "organization_member_added",
        "organization_member_role_changed",
        "organization_member_deactivated",
        "organization_member_reactivated",
        "organization_member_removed",
      ],
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    membershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrganizationMembership",
      required: true,
    },
    affectedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    actorPlatformRole: { type: String, required: true, trim: true },
    action: { type: String, required: true, trim: true },
    beforeRole: { type: String, default: null },
    afterRole: { type: String, default: null },
    beforeStatus: { type: String, default: null },
    afterStatus: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export default mongoose.model(
  "OrganizationMembershipAudit",
  OrganizationMembershipAuditSchema,
);
