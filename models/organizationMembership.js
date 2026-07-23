import mongoose from "mongoose";

import Organization from "./organization.js";
import User from "./user.js";
import {
  ORGANIZATION_ROLES,
  assertOrganizationRoleAssignment,
} from "../utils/roleSeparation.js";

const OrganizationMembershipSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    role: {
      type: String,
      enum: ORGANIZATION_ROLES,
      default: "member",
    },

    status: {
      type: String,
      enum: ["active", "inactive", "removed"],
      default: "active",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    invitedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const synchronizeOrganizationMembershipDocument = (membership) => {
  if (membership.status === "removed") {
    membership.isActive = false;
    return membership;
  }

  if (
    membership.isModified("isActive") &&
    membership.isActive === false
  ) {
    membership.status = "inactive";
  } else if (
    membership.isModified("isActive") &&
    membership.isActive === true &&
    !membership.isModified("status")
  ) {
    membership.status = "active";
  }

  membership.isActive = membership.status === "active";
  return membership;
};

OrganizationMembershipSchema.pre(
  "save",
  function synchronizeOrganizationMembershipState(next) {
    synchronizeOrganizationMembershipDocument(this);
    next();
  }
);

export const normalizeOrganizationMembershipUpdate = (
  sourceUpdate = {}
) => {
  const update = { ...sourceUpdate };
  const directStatus = update.status;
  const directIsActive = update.isActive;
  const setUpdate = { ...(update.$set || {}) };
  const nextStatus = setUpdate.status ?? directStatus;
  const nextIsActive = setUpdate.isActive ?? directIsActive;
  const touchesStatus = nextStatus !== undefined;
  const touchesIsActive = nextIsActive !== undefined;

  if (touchesIsActive && !touchesStatus) {
    throw new Error(
      "OrganizationMembership updates must set status instead of isActive."
    );
  }

  if (!touchesStatus) return update;

  let canonicalStatus = nextStatus;

  if (nextStatus === "removed") {
    canonicalStatus = "removed";
  } else if (touchesIsActive && nextIsActive === false) {
    canonicalStatus = "inactive";
  }

  delete update.status;
  delete update.isActive;
  update.$set = {
    ...setUpdate,
    status: canonicalStatus,
    isActive: canonicalStatus === "active",
  };

  return update;
};

export const validateOrganizationMembershipReferences = async (
  membership,
  {
    OrganizationModel = Organization,
    UserModel = User,
  } = {}
) => {
  assertOrganizationRoleAssignment({
    platformRole: "none",
    organizationRole: membership.role,
  });

  if (!membership.organizationId || !membership.userId) return;

  const [organizationExists, user] = await Promise.all([
    OrganizationModel.exists({ _id: membership.organizationId }),
    UserModel.findById(membership.userId).select("_id platformRole"),
  ]);

  if (!organizationExists) {
    const error = new Error("Referenced Organization does not exist.");
    error.code = "ORGANIZATION_NOT_FOUND";
    throw error;
  }

  if (!user) {
    const error = new Error("Referenced User does not exist.");
    error.code = "USER_NOT_FOUND";
    throw error;
  }

  assertOrganizationRoleAssignment({
    platformRole: user.platformRole || "none",
    organizationRole: membership.role,
  });
};

OrganizationMembershipSchema.pre("validate", async function validateRefs() {
  await validateOrganizationMembershipReferences(this);
});

const synchronizeOrganizationMembershipUpdate =
  function synchronizeUpdate(next) {
    try {
      this.setUpdate(
        normalizeOrganizationMembershipUpdate(this.getUpdate())
      );
    } catch (error) {
      return next(error);
    }
    return next();
  };

OrganizationMembershipSchema.pre(
  "updateOne",
  synchronizeOrganizationMembershipUpdate
);
OrganizationMembershipSchema.pre(
  "updateMany",
  synchronizeOrganizationMembershipUpdate
);
OrganizationMembershipSchema.pre(
  "findOneAndUpdate",
  synchronizeOrganizationMembershipUpdate
);
OrganizationMembershipSchema.pre(
  "replaceOne",
  synchronizeOrganizationMembershipUpdate
);
OrganizationMembershipSchema.pre(
  "findOneAndReplace",
  synchronizeOrganizationMembershipUpdate
);

OrganizationMembershipSchema.index(
  { organizationId: 1, userId: 1 },
  { unique: true }
);
OrganizationMembershipSchema.index({ organizationId: 1, status: 1 });
OrganizationMembershipSchema.index({ userId: 1, status: 1 });

export default mongoose.model(
  "OrganizationMembership",
  OrganizationMembershipSchema
);
