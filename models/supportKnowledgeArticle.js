import mongoose from "mongoose";

const SupportKnowledgeArticleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["api_key", "technical", "billing", "users", "apps", "general"],
      default: "general",
      index: true,
    },
    content: { type: String, required: true, trim: true },
    keywords: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    updatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

SupportKnowledgeArticleSchema.index({ title: "text", content: "text", keywords: "text" });

export default mongoose.model("SupportKnowledgeArticle", SupportKnowledgeArticleSchema);
