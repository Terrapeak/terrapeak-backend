import mongoose from "mongoose";

const SupportMessageSchema = new mongoose.Schema(
  {
    senderType: {
      type: String,
      enum: ["customer", "agent", "system"],
      required: true,
    },
    senderUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    senderName: { type: String, default: "" },
    body: { type: String, required: true, trim: true, maxlength: 10000 },
    readByCustomer: { type: Boolean, default: false },
    readByPlatform: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const SupportConversationSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subject: { type: String, required: true, trim: true, maxlength: 180 },
    category: {
      type: String,
      enum: ["api_key", "technical", "billing", "users", "apps", "general"],
      default: "general",
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    status: {
      type: String,
      enum: ["new", "needs_reply", "waiting_customer", "resolved"],
      default: "new",
      index: true,
    },
    assignedToUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    messages: { type: [SupportMessageSchema], default: [] },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SupportConversationSchema.index({ companyId: 1, lastMessageAt: -1 });

export default mongoose.model("SupportConversation", SupportConversationSchema);
