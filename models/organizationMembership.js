import mongoose from "mongoose";

import Organization from "./organization.js";
import User from "./user.js";
import {
  ORGANIZATION_ROLES,
  assertOrganizationRoleAssignment,
  isOrganizationRole,
} from "../utils/roleSeparation.js";

const ORGANIZATION_MEMBERSHIP_STATUSES = new Set([
  "active",
  "inactive",
  "removed",
]);
const PROTECTED_MEMBERSHIP_FIELDS = new Set([
  "organizationId",
  "userId",
  "role",
  "status",
  "isActive",
]);

const membershipWriteError = (code, message, statusCode = 400) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

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

  if (membership.isNew || membership.status === "active") {
    assertOrganizationRoleAssignment({
      platformRole: user.platformRole || "none",
      organizationRole: membership.role,
    });
  }
};

export const validateOrganizationMembershipOwnerRetention = async (
  membership,
  { MembershipModel = membership.constructor } = {}
) => {
  if (membership.isNew || !membership._id) return;

  const persisted = await MembershipModel.findById(membership._id).select(
    "_id organizationId role status"
  );
  const removesActiveOwner =
    persisted?.role === "owner" &&
    persisted.status === "active" &&
    (membership.role !== "owner" || membership.status !== "active");

  if (!removesActiveOwner) return;

  const replacementOwner = await MembershipModel.findOne({
    organizationId: persisted.organizationId,
    _id: { $ne: persisted._id },
    role: "owner",
    status: "active",
  }).select("_id");

  if (!replacementOwner) {
    throw membershipWriteError(
      "ORGANIZATION_FINAL_OWNER_REQUIRED",
      "An Organization must retain at least one active owner.",
      409
    );
  }
};

OrganizationMembershipSchema.pre("validate", async function validateRefs() {
  await validateOrganizationMembershipReferences(this);
  await validateOrganizationMembershipOwnerRetention(this);
});

const getTouchedMembershipFields = (update) => {
  if (Array.isArray(update)) {
    throw membershipWriteError(
      "ORGANIZATION_MEMBERSHIP_SERVICE_REQUIRED",
      "Organization membership update pipelines are not permitted.",
      409
    );
  }

  const touched = new Set();
  for (const [key, value] of Object.entries(update || {})) {
    if (key.startsWith("$") && value && typeof value === "object") {
      for (const field of Object.keys(value)) {
        if (PROTECTED_MEMBERSHIP_FIELDS.has(field)) touched.add(field);
      }
    } else if (PROTECTED_MEMBERSHIP_FIELDS.has(key)) {
      touched.add(key);
    }
  }
  return touched;
};

export const validateOrganizationMembershipQueryMutation = async ({
  current,
  normalizedUpdate,
  MembershipModel,
  OrganizationModel = Organization,
  UserModel = User,
}) => {
  const setUpdate = normalizedUpdate.$set || {};
  const nextOrganizationId =
    setUpdate.organizationId ??
    normalizedUpdate.organizationId ??
    current.organizationId;
  const nextUserId =
    setUpdate.userId ?? normalizedUpdate.userId ?? current.userId;
  const nextRole = setUpdate.role ?? normalizedUpdate.role ?? current.role;
  const nextStatus =
    setUpdate.status ?? normalizedUpdate.status ?? current.status;

  if (!isOrganizationRole(nextRole)) {
    throw membershipWriteError(
      "INVALID_ORGANIZATION_ROLE",
      "Invalid Organization role."
    );
  }
  if (!ORGANIZATION_MEMBERSHIP_STATUSES.has(nextStatus)) {
    throw membershipWriteError(
      "INVALID_ORGANIZATION_MEMBERSHIP_STATUS",
      "Invalid Organization membership status."
    );
  }

  const [organizationExists, user] = await Promise.all([
    OrganizationModel.exists({ _id: nextOrganizationId }),
    UserModel.findById(nextUserId).select("_id platformRole"),
  ]);

  if (!organizationExists) {
    throw membershipWriteError(
      "ORGANIZATION_NOT_FOUND",
      "Referenced Organization does not exist.",
      404
    );
  }
  if (!user) {
    throw membershipWriteError(
      "USER_NOT_FOUND",
      "Referenced User does not exist.",
      404
    );
  }

  if (nextStatus === "active") {
    assertOrganizationRoleAssignment({
      platformRole: user.platformRole || "none",
      organizationRole: nextRole,
    });
  }

  const removesActiveOwner =
    current.role === "owner" &&
    current.status === "active" &&
    (nextRole !== "owner" || nextStatus !== "active");

  if (removesActiveOwner) {
    const replacementOwner = await MembershipModel.findOne({
      organizationId: current.organizationId,
      _id: { $ne: current._id },
      role: "owner",
      status: "active",
    }).select("_id");
    if (!replacementOwner) {
      throw membershipWriteError(
        "ORGANIZATION_FINAL_OWNER_REQUIRED",
        "An Organization must retain at least one active owner.",
        409
      );
    }
  }
};

const synchronizeOrganizationMembershipUpdate =
  async function synchronizeUpdate() {
    const sourceUpdate = this.getUpdate() || {};
    const touched = getTouchedMembershipFields(sourceUpdate);
    if (!touched.size) return;

    for (const operator of ["$unset", "$rename"]) {
      const fields = Object.keys(sourceUpdate[operator] || {});
      if (fields.some((field) => PROTECTED_MEMBERSHIP_FIELDS.has(field))) {
        throw membershipWriteError(
          "ORGANIZATION_MEMBERSHIP_SERVICE_REQUIRED",
          "Protected Organization membership fields cannot be removed or renamed.",
          409
        );
      }
    }

    if (this.op === "updateMany") {
      throw membershipWriteError(
        "ORGANIZATION_MEMBERSHIP_SERVICE_REQUIRED",
        "Bulk Organization membership mutations must use the validated service.",
        409
      );
    }

    if (
      this.op === "replaceOne" ||
      this.op === "findOneAndReplace"
    ) {
      throw membershipWriteError(
        "ORGANIZATION_MEMBERSHIP_SERVICE_REQUIRED",
        "Organization membership replacements must use the validated service.",
        409
      );
    }

    if (this.getOptions().upsert) {
      throw membershipWriteError(
        "ORGANIZATION_MEMBERSHIP_SERVICE_REQUIRED",
        "Organization membership upserts must use the validated service.",
        409
      );
    }

    const normalizedUpdate =
      normalizeOrganizationMembershipUpdate(sourceUpdate);
    const current = await this.model.findOne(this.getQuery());
    if (!current) {
      this.setUpdate(normalizedUpdate);
      this.setOptions({ runValidators: true });
      return;
    }

    await validateOrganizationMembershipQueryMutation({
      current,
      normalizedUpdate,
      MembershipModel: this.model,
    });

    this.setUpdate(normalizedUpdate);
    this.setOptions({ runValidators: true });
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

const rejectOrganizationMembershipDelete = function rejectDelete(next) {
  next(
    membershipWriteError(
      "ORGANIZATION_MEMBERSHIP_SERVICE_REQUIRED",
      "Organization memberships must be removed through the validated service.",
      409
    )
  );
};

OrganizationMembershipSchema.pre(
  "deleteOne",
  { document: false, query: true },
  rejectOrganizationMembershipDelete
);
OrganizationMembershipSchema.pre(
  "deleteOne",
  { document: true, query: false },
  rejectOrganizationMembershipDelete
);
OrganizationMembershipSchema.pre(
  "deleteMany",
  rejectOrganizationMembershipDelete
);
OrganizationMembershipSchema.pre(
  "findOneAndDelete",
  rejectOrganizationMembershipDelete
);

OrganizationMembershipSchema.pre(
  "insertMany",
  function validateInsertedMemberships(next, documents) {
    Promise.resolve()
      .then(async () => {
        for (const source of documents) {
          const membership = new this(source);
          synchronizeOrganizationMembershipDocument(membership);
          await membership.validate();
          source.status = membership.status;
          source.isActive = membership.isActive;
        }
      })
      .then(() => next(), next);
  }
);

OrganizationMembershipSchema.pre(
  "bulkWrite",
  function rejectMembershipBulkWrite(next) {
    next(
      membershipWriteError(
        "ORGANIZATION_MEMBERSHIP_SERVICE_REQUIRED",
        "Organization membership bulk writes must use the validated service.",
        409
      )
    );
  }
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
