import mongoose from "mongoose";

const ORGANIZATION_STATUSES = ["active", "inactive", "archived"];

const OrganizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ORGANIZATION_STATUSES,
      default: "active",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

export const synchronizeOrganizationDocument = (organization) => {
  if (organization.status === "archived") {
    organization.isActive = false;
    return organization;
  }

  if (
    organization.isModified("isActive") &&
    organization.isActive === false
  ) {
    organization.status = "inactive";
  } else if (
    organization.isModified("isActive") &&
    organization.isActive === true &&
    !organization.isModified("status")
  ) {
    organization.status = "active";
  }

  organization.isActive = organization.status === "active";
  return organization;
};

OrganizationSchema.pre("save", function synchronizeOrganizationState(next) {
  synchronizeOrganizationDocument(this);
  next();
});

export const normalizeOrganizationUpdate = (sourceUpdate = {}) => {
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
      "Organization updates must set status instead of isActive."
    );
  }

  if (!touchesStatus) return update;

  let canonicalStatus = nextStatus;

  if (nextStatus === "archived") {
    canonicalStatus = "archived";
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

const synchronizeOrganizationUpdate = function synchronizeUpdate(next) {
  try {
    this.setUpdate(normalizeOrganizationUpdate(this.getUpdate()));
  } catch (error) {
    return next(error);
  }
  return next();
};

OrganizationSchema.pre("updateOne", synchronizeOrganizationUpdate);
OrganizationSchema.pre("updateMany", synchronizeOrganizationUpdate);
OrganizationSchema.pre("findOneAndUpdate", synchronizeOrganizationUpdate);
OrganizationSchema.pre("replaceOne", synchronizeOrganizationUpdate);
OrganizationSchema.pre("findOneAndReplace", synchronizeOrganizationUpdate);

OrganizationSchema.index({ slug: 1 }, { unique: true });
OrganizationSchema.index({ status: 1 });

export default mongoose.model("Organization", OrganizationSchema);
