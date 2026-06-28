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
  },
  {
    timestamps: true,
  }
);

CompanyMembershipSchema.index(
  { companyId: 1, userId: 1 },
  { unique: true }
);

export default mongoose.model("CompanyMembership", CompanyMembershipSchema);