import mongoose from "mongoose";

const SupportSavedReplySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    category: {
      type: String,
      enum: ["general", "technical", "billing", "users", "apps", "api_key"],
      default: "general",
      index: true,
    },
    body: { type: String, required: true, trim: true, maxlength: 10000 },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId,