import asyncHandler from "express-async-handler";
import SupportConversation from "../models/supportConversation.js";
import SupportInternalNote from "../models/supportInternalNote.js";

export const listConversationInternalNotes = asyncHandler(async (req, res) => {
  const conversation = await SupportConversation.findById(req.params.conversationId).select("_id");
  if (!conversation) {
    return res.status(404).json({ success: false, message: "Support conversation not found." });
  }

  const notes = await SupportInternalNote.find({ conversationId: conversation._id })
    .populate("createdByUserId", "name email platformRole")
    .sort({ createdAt: 1 })
    .lean();

  res.json({ success: true, notes });
});

export const createConversationInternalNote = asyncHandler(async (req, res) => {
  const conversation = await SupportConversation.findById(req.params.conversationId).select("_id companyId");
  if (!conversation) {
    return res.status(404).json({ success: false, message: "Support conversation not found." });
  }

  const body = String(req.body.body || "").trim();
  if (!body) {
    return res.status(400).json({ success: false, message: "Internal note is required." });
  }

  const note = await SupportInternalNote.create({
    conversationId: conversation._id,
    companyId: conversation.companyId,
    body,
    createdByUserId: req.userId,
    createdByName: req.platformUser?.name || req.platformUser?.email || "Terrapeak team",
  });

  await note.populate("createdByUserId", "name email platformRole");
  res.status(201).json({ success: true, note });
});
