import asyncHandler from "express-async-handler";
import SupportConversation from "../models/supportConversation.js";
import SupportTask from "../models/supportTask.js";

const ALLOWED_STATUSES = new Set(["open", "in_progress", "done", "cancelled"]);
const ALLOWED_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

export const listConversationTasks = asyncHandler(async (req, res) => {
  const conversation = await SupportConversation.findById(req.params.conversationId).select("_id");
  if (!conversation) {
    return res.status(404).json({ success: false, message: "Support conversation not found." });
  }

  const tasks = await SupportTask.find({ conversationId: conversation._id })
    .populate("assignedToUserId", "name email")
    .sort({ createdAt: -1 })
    .lean();

  res.json({ success: true, tasks });
});

export const createConversationTask = asyncHandler(async (req, res) => {
  const conversation = await SupportConversation.findById(req.params.conversationId);
  if (!conversation) {
    return res.status(404).json({ success: false, message: "Support conversation not found." });
  }

  const title = String(req.body.title || "").trim();
  if (!title) {
    return res.status(400).json({ success: false, message: "Task title is required." });
  }

  const priority = ALLOWED_PRIORITIES.has(req.body.priority) ? req.body.priority : conversation.priority || "normal";
  const task = await SupportTask.create({
    conversationId: conversation._id,
    companyId: conversation.companyId,
    title,
    notes: String(req.body.notes || "").trim(),
    priority,
    assignedToUserId: req.body.assignedToUserId || null,
    dueAt: req.body.dueAt || null,
    createdByUserId: req.userId || null,
    source: req.body.source === "ai_suggestion" ? "ai_suggestion" : "manual",
  });

  res.status(201).json({ success: true, task });
});

export const createTaskFromAiSuggestion = asyncHandler(async (req, res) => {
  const conversation = await SupportConversation.findById(req.params.conversationId);
  if (!conversation) {
    return res.status(404).json({ success: false, message: "Support conversation not found." });
  }

  const suggestedAction = String(conversation.aiAnalysis?.suggestedAction || "").trim();
  if (!suggestedAction) {
    return res.status(400).json({ success: false, message: "No AI suggested action is available for this conversation." });
  }

  const existing = await SupportTask.findOne({
    conversationId: conversation._id,
    title: suggestedAction,
    status: { $in: ["open", "in_progress"] },
  });

  if (existing) {
    return res.status(409).json({ success: false, message: "An open task already exists for this AI suggestion." });
  }

  const task = await SupportTask.create({
    conversationId: conversation._id,
    companyId: conversation.companyId,
    title: suggestedAction,
    priority: conversation.priority || "normal",
    createdByUserId: req.userId || null,
    source: "ai_suggestion",
  });

  res.status(201).json({ success: true, task });
});

export const updateConversationTask = asyncHandler(async (req, res) => {
  const task = await SupportTask.findOne({
    _id: req.params.taskId,
    conversationId: req.params.conversationId,
  });

  if (!task) {
    return res.status(404).json({ success: false, message: "Support task not found." });
  }

  if (req.body.title !== undefined) {
    const title = String(req.body.title || "").trim();
    if (!title) return res.status(400).json({ success: false, message: "Task title is required." });
    task.title = title;
  }
  if (req.body.notes !== undefined) task.notes = String(req.body.notes || "").trim();
  if (req.body.priority !== undefined && ALLOWED_PRIORITIES.has(req.body.priority)) task.priority = req.body.priority;
  if (req.body.status !== undefined) {
    if (!ALLOWED_STATUSES.has(req.body.status)) {
      return res.status(400).json({ success: false, message: "Invalid task status." });
    }
    task.status = req.body.status;
    task.completedAt = req.body.status === "done" ? new Date() : null;
  }
  if (req.body.assignedToUserId !== undefined) task.assignedToUserId = req.body.assignedToUserId || null;
  if (req.body.dueAt !== undefined) task.dueAt = req.body.dueAt || null;

  await task.save();
  res.json({ success: true, task });
});
