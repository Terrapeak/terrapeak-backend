import mongoose from "mongoose";

const SupportNotificationSchema = new mongoose.Schema(
  {
    recipientUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["conversation_assigned", "task_assigned", "customer_reply", "task_overdue"],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 240 },
    body: { type: String, default: "", trim: true, maxlength: 1000 },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportConversation",
      default: null,
      index: true,
    },
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportTask",
      default: null,
      index: true,
    },
    readAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

SupportNotificationSchema.index(
  { recipientUserId: 1, type: 1, conversationId: 1, taskId: 1 },
  { unique: true }
);

export default mongoose.model("SupportNotification", SupportNotificationSchema);
