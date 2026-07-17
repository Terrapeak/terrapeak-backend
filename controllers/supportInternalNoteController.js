import asyncHandler from "express-async-handler";
import SupportConversation from "../models/supportConversation.js";
import SupportInternalNote from "../models/supportInternalNote.js";

export const listConversationInternalNotes = asyncHandler(async (req, res) => {
  const conversation = await SupportConversation.findById(req.params.conversationId).select("_id");
  if (!conversation) {
    return res.status(404).json({ success: false, message: "Support conversation not found." });
  }

  const notes = await SupportInternal