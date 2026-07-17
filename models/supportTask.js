import mongoose from "mongoose";

const SupportTaskSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportConversation",
      required: true,
      index: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 240 },
    notes: { type: String, default: "", trim: true, maxlength: 3000 },
    status: {
      type: String,
      enum: ["open", "in_progress", "done", "cancelled"],
      default: "open",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    assignedToUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    dueAt: { type: Date, default: null },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    source: {
      type: String,
      enum: ["manual", "ai_suggestion"],
      default: "manual",
    },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SupportTaskSchema.index({ conversationId: 1, createdAt: -1 });

export default mongoose.model("SupportTask", SupportTaskSchema);
