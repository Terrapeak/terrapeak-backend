import mongoose from "mongoose";

const AppSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
    },

    category: {
      type: String,
      enum: ["core", "business", "communication", "analytics", "future"],
      default: "business",
    },

    isCore: {
      type: Boolean,
      default: false,
    },

    standalone: {
      type: Boolean,
      default: true,
    },

    requiresAIAssistant: {
      type: Boolean,
      default: false,
    },

    launchUrl: {
      type: String,
      default: "",
    },

    isVisible: {
      type: Boolean,
      default: true,
    },

    isComingSoon: {
  type: Boolean,
  default: false,
},

allowInstall: {
  type: Boolean,
  default: true,
},

minimumPlan: {
  type: String,
  enum: ["demo", "starter", "business", "pro", "enterprise"],
  default: "starter",
},

dependencies: {
  type: [String],
  default: [],
},

icon: {
  type: String,
  default: "",
},

sortOrder: {
  type: Number,
  default: 100,
},
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("App", AppSchema);