import mongoose from "mongoose";

const CompanySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    displayName: {
      type: String,
      default: "",
    },

    referencePrefix: {
      type: String,
      default: "BOT",
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    reservationBusinessSlug: {
      type: String,
      default: "",
    },

    installedApps: {
      type: [String],
      default: ["ai-assistant"],
    },

    plan: {
      type: String,
      enum: ["starter", "growth", "professional", "enterprise"],
      default: "starter",
    },

    maxUsers: {
      type: Number,
      default: 1,
    },

    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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

export default mongoose.model("Company", CompanySchema);