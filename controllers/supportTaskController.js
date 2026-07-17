import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import SupportConversation from "../models/supportConversation.js";
import SupportTask from "../models/supportTask.js";
import User from "../models/user.js";

const ALLOWED_STATUSES = new Set(["open", "in_progress", "done", "cancelled"]);
const ALLOWED_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const PLATFORM_ROLES = [
  "platform-owner",
  "platform-admin",
  "support-admin",
  "billing-admin",
  "developer-admin",
  "sales-admin",
  "viewer",
];

const normalizeAssignee = async (value) => {
  if (!value) return null;

  if (!mongoose.Types.ObjectId.isValid(value)) {
    const error = new Error("Invalid assignee.");
    error.status = 400;
    throw error;
  }

  const user = await User.findOne({
    _id: value,
    platformRole: { $in: PLATFORM_ROLES },
    accountStatus: { $ne: "removed" },
  }).select("_id");

  if (!user) {
    const error = new Error("Selected assignee is not an active platform user.");
    error.status = 400;
    throw error;
  }

  return user._id;
};

const syncConversationOwnerIfUnassigned = async (conversationId, assignedToUserId) => {
  if (!assignedToUserId) return;
  await SupportConversation.updateOne(
    { _id: conversationId, assignedToUserId: null },
    { $set: { assignedToUserId } }
  );
};

export const listSupportAssignees = asyncHandler(async (req, res) => {
  const users = await User.find({
    platformRole: { $in: PLATFORM_ROLES },
    accountStatus: { $ne: "removed" },
  })
    .select("name email platformRole accountStatus")
    .sort({ name: 1, email: 1 })
    .lean();

  res.json({ success: true, users });
});

export const listPlatformTasks = asyncHandler(async (req, res) => {
  const query = {};

  if (req.query.status && req.query.status !== "all") {
    if (!ALLOWED_STATUSES.has(req.query.status)) {
      return res.status(400).json({ success: false, message: "Invalid task status." });
    }
    query.status = req.query.status;
  }

  if (req.query.priority && req.query.priority !== "all") {
    if (!ALLOWED_PRIORITIES.has(req.query.priority)) {
      return res.status(400).json({ success: false, message: "Invalid task priority." });
    }
    query.priority = req.query.priority;
  }

  if (req.query.assignee === "unassigned") query.assignedToUserId = null;
  if (req.query.assignee && !["all", "unassigned"].includes(req.query.assignee)) {
    if (!mongoose.Types.ObjectId.isValid(req.query.assignee)) {
      return res.status(400).json({ success: false, message: "Invalid assignee filter." });
    }
    query.assignedToUserId = req.query.assignee;
  }

  if (req.query.overdue === "true") {
    query.dueAt = { $lt: new Date(new Date().setHours(0, 0, 0, 0)) };
    query.status = { $nin: ["done", "cancelled"] };
  }

  const tasks = await SupportTask.find(query)
    .populate("assignedToUserId", "name email platformRole")
    .populate("companyId", "name displayName slug")
    .populate("conversationId", "subject status priority")
    .sort({ dueAt: 1, createdAt: -1 })
    .lean();

  res.json({ success: true, tasks });
});

export const listConversationTasks = asyncHandler(async (req, res) => {
  const conversation = await SupportConversation.findById(req.params.conversationId).select("_id");
  if (!conversation) {
    return res.status(404).json({ success: false, message: "Support conversation not found." });
  }

  const tasks = await SupportTask.find({ conversationId: conversation._id })
    .populate("assignedToUserId", "name email platformRole")
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

  const priority = ALLOWED_PRIORITIES.has(req.body.priority)
    ? req.body.priority
    : conversation.priority || "normal";
  const requestedAssignee = req.body.assignedToUserId !== undefined
    ? await normalizeAssignee(req.body.assignedToUserId)
    : conversation.assignedToUserId || null;

  const task = await SupportTask.create({
    conversationId: conversation._id,
    companyId: conversation.companyId,
    title,
    notes: String(req.body.notes || "").trim(),
    priority,
    assignedToUserId: requestedAssignee,
    dueAt: req.body.dueAt || null,
    createdByUserId: req.userId || null,
    source: req.body.source === "ai_suggestion" ? "ai_suggestion" : "manual",
  });

  await syncConversationOwnerIfUnassigned(conversation._id, requestedAssignee);
  await task.populate("assignedToUserId", "name email platformRole");
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

  const requestedAssignee = req.body.assignedToUserId !== undefined
    ? await normalizeAssignee(req.body.assignedToUserId)
    : conversation.assignedToUserId || null;
  const task = await SupportTask.create({
    conversationId: conversation._id,
    companyId: conversation.companyId,
    title: suggestedAction,
    priority: conversation.priority || "normal",
    assignedToUserId: requestedAssignee,
    dueAt: req.body.dueAt || null,
    createdByUserId: req.userId || null,
    source: "ai_suggestion",
  });

  await syncConversationOwnerIfUnassigned(conversation._id, requestedAssignee);
  await task.populate("assignedToUserId", "name email platformRole");
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
    if (!title) {
      return res.status(400).json({ success: false, message: "Task title is required." });
    }
    task.title = title;
  }

  if (req.body.notes !== undefined) task.notes = String(req.body.notes || "").trim();
  if (req.body.priority !== undefined && ALLOWED_PRIORITIES.has(req.body.priority)) {
    task.priority = req.body.priority;
  }

  if (req.body.status !== undefined) {
    if (!ALLOWED_STATUSES.has(req.body.status)) {
      return res.status(400).json({ success: false, message: "Invalid task status." });
    }
    task.status = req.body.status;
    task.completedAt = req.body.status === "done" ? new Date() : null;
  }

  let normalizedAssignee;
  if (req.body.assignedToUserId !== undefined) {
    normalizedAssignee = await normalizeAssignee(req.body.assignedToUserId);
    task.assignedToUserId = normalizedAssignee;
  }
  if (req.body.dueAt !== undefined) task.dueAt = req.body.dueAt || null;

  await task.save();
  if (normalizedAssignee) {
    await syncConversationOwnerIfUnassigned(task.conversationId, normalizedAssignee);
  }
  await task.populate("assignedToUserId", "name email platformRole");
  res.json({ success: true, task });
});