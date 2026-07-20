import asyncHandler from "express-async-handler";
import SupportSavedReply from "../models/supportSavedReply.js";

const CATEGORIES = new Set(["general", "technical", "billing", "users", "apps", "api_key"]);

const normalizePayload = (body) => {
  const title = String(body.title || "").trim();
  const replyBody = String(body.body || "").trim();
  const category = CATEGORIES.has(body.category) ? body.category : "general";
  if (!title || !replyBody) {
    const error = new Error("Title and reply body are required.");
    error.status = 400;
    throw error;
  }
  return { title, body: replyBody, category };
};

export const listSupportSavedReplies = asyncHandler(async (req, res) => {
  const replies = await SupportSavedReply.find({ isActive: true })
    .populate("createdByUserId", "name email")
    .populate("updatedByUserId", "name email")
    .sort({ category: 1, title: 1 })
    .lean();
  res.json({ success: true, replies });
});

export const createSupportSavedReply = asyncHandler(async (req, res) => {
  const payload = normalizePayload(req.body);
  const reply = await SupportSavedReply.create({
    ...payload,
    createdByUserId: req.userId,
    updatedByUserId: req.userId,
  });
  res.status(201).json({ success: true, reply });
});

export const updateSupportSavedReply = asyncHandler(async (req, res) => {
  const payload = normalizePayload(req.body);
  const reply = await SupportSavedReply.findByIdAndUpdate(
    req.params.replyId,
    { ...payload, updatedByUserId: req.userId },
    { new: true, runValidators: true }
  );
  if (!reply) return res.status(404).json({ success: false, message: "Saved reply not found." });
  res.json({ success: true, reply });
});

export const deleteSupportSavedReply = asyncHandler(async (req, res) => {
  const reply = await SupportSavedReply.findByIdAndUpdate(
    req.params.replyId,
    { isActive: false, updatedByUserId: req.userId },
    { new: true }
  );
  if (!reply) return res.status(404).json({ success: false, message: "Saved reply not found." });
  res.json({ success: true });
});
