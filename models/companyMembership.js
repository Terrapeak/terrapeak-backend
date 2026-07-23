import mongoose from "mongoose";

const CompanyMembershipSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    role: {
      type: String,
      enum: ["owner", "admin", "manager", "staff", "viewer"],
      default: "staff",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    status: {
      type: String,
      enum: ["active", "inactive", "removed"],
      default: "active",
      index: true,
    },

    removedAt: {
      type: Date,
      default: null,
    },

    removedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const synchronizeCompanyMembershipDocument = (membership) => {
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

CompanyMembershipSchema.pre("save", function syncMembershipState(next) {
  synchronizeCompanyMembershipDocument(this);
  next();
});

export const normalizeCompanyMembershipUpdate = (sourceUpdate = {}) => {
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
      "CompanyMembership updates must set status instead of isActive."
    );
  }

  if (!touchesStatus) {
    return update;
  }

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

const syncMembershipUpdateState = function syncMembershipUpdateState(next) {
  try {
    this.setUpdate(normalizeCompanyMembershipUpdate(this.getUpdate()));
  } catch (error) {
    return next(error);
  }
  return next();
};

CompanyMembershipSchema.pre("updateOne", syncMembershipUpdateState);
CompanyMembershipSchema.pre("updateMany", syncMembershipUpdateState);
CompanyMembershipSchema.pre("findOneAndUpdate", syncMembershipUpdateState);
CompanyMembershipSchema.pre("replaceOne", syncMembershipUpdateState);
CompanyMembershipSchema.pre("findOneAndReplace", syncMembershipUpdateState);

CompanyMembershipSchema.index(
  { companyId: 1, userId: 1 },
  { unique: true }
);

export default mongoose.model("CompanyMembership", CompanyMembershipSchema);
