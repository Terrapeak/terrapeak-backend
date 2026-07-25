import mongoose from "mongoose";

const ORGANIZATION_STATUSES = ["active", "inactive", "archived"];
const BILLING_STATUSES = [
  "not_configured",
  "trial",
  "active",
  "past_due",
  "cancelled",
  "manual",
];
const PAYMENT_STATUSES = [
  "not_configured",
  "paid",
  "unpaid",
  "past_due",
  "failed",
  "manual",
];
const PLANS = ["starter", "growth", "professional", "enterprise"];

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

    billingMode: {
      type: String,
      enum: ["organization", "company"],
      default: "company",
      index: true,
    },

    plan: {
      type: String,
      enum: PLANS,
      default: "starter",
    },

    billing: {
      status: {
        type: String,
        enum: BILLING_STATUSES,
        default: "not_configured",
      },
      trialEndDate: {
        type: Date,
        default: null,
      },
      renewalDate: {
        type: Date,
        default: null,
      },
      contractEndDate: {
        type: Date,
        default: null,
      },
      creditsRemaining: {
        type: Number,
        default: null,
      },
      paymentStatus: {
        type: String,
        enum: PAYMENT_STATUSES,
        default: "not_configured",
      },
      maxUsers: {
        type: Number,
        default: null,
      },
      maxCompanies: {
        type: Number,
        default: null,
      },
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
  },
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
      "Organization updates must set status instead of isActive.",
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
OrganizationSchema.index({ billingMode: 1, "billing.status": 1 });

export default mongoose.model("Organization", OrganizationSchema);
