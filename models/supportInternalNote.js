import mongoose from "mongoose";

const SupportInternalNoteSchema = new mongoose.Schema(
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
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdByName: { type: String, default: "Terrapeak team" },
  },
  { timestamps: true }
);

SupportInternalNoteSchema.index({ conversationId: 1, createdAt: 1 });

export default mongoose.model("SupportInternalNote", SupportInternalNoteSchema);