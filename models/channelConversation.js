import mongoose from "mongoose";

const ChannelConversationSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
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
    channelAccountId: {
      type: String,
      required: true,
      trim: true,
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
    status: {
      type: String,
      enum: ["open", "closed", "archived"],
      default: "open",
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
    lastEventType: {
      type: String,
      default: "",
      trim: true,
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

ChannelConversationSchema.index(
  {
    companyId: 1,
    channel: 1,
    channelAccountId: 1,
    externalConversationId: 1,
  },
  { unique: true }
);

export default mongoose.model(
  "ChannelConversation",
  ChannelConversationSchema
);
