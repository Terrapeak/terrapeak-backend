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

CompanyMembershipSchema.pre("save", function syncMembershipState(next) {
  if (this.status === "active") this.isActive = true;
  if (this.status === "inactive" || this.status === "removed") this.isActive = false;
  next();
});

CompanyMembershipSchema.index(
  { companyId: 1, userId: 1 },
  { unique: true }
);

export default mongoose.model("CompanyMembership", CompanyMembershipSchema);
