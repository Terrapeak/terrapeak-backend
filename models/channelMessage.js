import mongoose from "mongoose";

const ChannelMessageSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChannelConversation",
      required: true,
      index: true,
    },
    channel: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    externalConversationId: {
      type: String,
      required: true,
      trim: true,
    },
    externalUserId: {
      type: String,
      required: true,
      trim: true,
    },
    direction: {
      type: String,
      enum: ["inbound", "outbound", "system"],
      required: true,
    },
    senderType: {
      type: String,
      enum: ["customer", "business", "system"],
      required: true,
    },
    message: {
      type: String,
      default: "",
    },
    externalMessageId: {
      type: String,
      default: "",
      trim: true,
    },
    deliveryStatus: {
      type: String,
      enum: ["received", "sent", "delivered", "read", "failed"],
      default: "received",
    },
    eventTimestamp: {
      type: Date,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    readAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

ChannelMessageSchema.index(
  { companyId: 1, channel: 1, externalMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      externalMessageId: { $type: "string", $gt: "" },
    },
  }
);

export default mongoose.model("ChannelMessage", ChannelMessageSchema);
