import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import CompanyMembership from "../models/companyMembership.js";
import SupportConversation from "../models/supportConversation.js";
import User from "../models/user.js";
import { analyzeSupportConversation } from "../services/supportAiService.js";
import { buildSupportCompanyContext } from "../services/supportContextService.js";
import { findRelevantSupportKnowledge } from "../services/supportKnowledgeService.js";

const PLATFORM_ROLES = [
  "platform-owner",
  "platform-admin",
  "support-admin",
  "billing-admin",
  "developer-admin",
  "sales-admin",
  "viewer",
];

const getActiveMembership = async (userId) =>
  CompanyMembership.findOne({ userId, isActive: true });

const normalizePlatformAssignee = async (value) => {
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

const serializeConversation = (conversation) => ({
  _id: conversation._id,
  companyId: conversation.companyId,
  createdByUserId: conversation.createdByUserId,
  subject: conversation.subject,
  category: conversation.category,
  priority: conversation.priority,
  status: conversation.status,
  assignedToUserId: conversation.assignedToUserId,
  messages: conversation.messages,
  aiAnalysis: conversation.aiAnalysis,
  lastMessageAt: conversation.lastMessageAt,
  resolvedAt: conversation.resolvedAt,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
});

const refreshAiAnalysis = async (conversation, { throwOnError = false } = {}) => {
  try {
    const [companyContext, knowledgeContext] = await Promise.all([
      buildSupportCompanyContext(conversation.companyId),
      findRelevantSupportKnowledge({
        subject: conversation.subject,
        messages: conversation.messages,
      }),
    ]);

    const analysis = await analyzeSupportConversation({
      subject: conversation.subject,
      messages: conversation.messages,
      companyContext,
      knowledgeContext,
    });

    conversation.aiAnalysis = analysis;
    conversation.category = analysis.category;
    conversation.priority = analysis.priority;
    await conversation.save();
    return analysis;
  } catch (error) {
    if (throwOnError) throw error;
    console.error("Support AI observation failed:", error?.code || error?.message || error);
    return null;
  }
};

export const listMySupportConversations = asyncHandler(async (req, res) => {
  const membership = await getActiveMembership(req.userId);
  if (!membership) return res.status(404).json({ success: false, message: "No active company membership found." });

  const conversations = await SupportConversation.find({ companyId: membership.companyId })
    .select("-aiAnalysis")
    .sort({ lastMessageAt: -1 })
    .lean();

  res.json({ success: true, conversations });
});

export const createSupportConversation = asyncHandler(async (req, res) => {
  const membership = await getActiveMembership(req.userId);
  if (!membership) return res.status(404).json({ success: false, message: "No active company membership found." });

  const user = await User.findById(req.userId).select("name email");
  const subject = String(req.body.subject || "").trim();
  const body = String(req.body.body || "").trim();
  if (!subject || !body) return res.status(400).json({ success: false, message: "Subject and message are required." });

  const conversation = await SupportConversation.create({
    companyId: membership.companyId,
    createdByUserId: req.userId,
    subject,
    category: req.body.category || "general",
    priority: req.body.priority || "normal",
    status: "new",
    messages: [{
      senderType: "customer",
      senderUserId: req.userId,
      senderName: user?.name || user?.email || "Customer",
      body,
      readByCustomer: true,
      readByPlatform: false,
    }],
    lastMessageAt: new Date(),
  });

  await refreshAiAnalysis(conversation);
  res.status(201).json({ success: true, conversation: serializeConversation(conversation) });
});

export const replyToMySupportConversation = asyncHandler(async (req, res) => {
  const membership = await getActiveMembership(req.userId);
  if (!membership) return res.status(404).json({ success: false, message: "No active company membership found." });

  const body = String(req.body.body || "").trim();
  if (!body) return res.status(400).json({ success: false, message: "Message is required." });

  const user = await User.findById(req.userId).select("name email");
  const conversation = await SupportConversation.findOne({ _id: req.params.conversationId, companyId: membership.companyId });
  if (!conversation) return res.status(404).json({ success: false, message: "Support conversation not found." });

  conversation.messages.push({
    senderType: "customer",
    senderUserId: req.userId,
    senderName: user?.name || user?.email || "Customer",
    body,
    readByCustomer: true,
    readByPlatform: false,
  });
  conversation.status = "needs_reply";
  conversation.lastMessageAt = new Date();
  conversation.resolvedAt = null;
  await conversation.save();
  await refreshAiAnalysis(conversation);

  res.json({ success: true, conversation: serializeConversation(conversation) });
});

export const listPlatformSupportConversations = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.status && req.query.status !== "all") query.status = req.query.status;

  const conversations = await SupportConversation.find(query)
    .populate("companyId", "name displayName slug")
    .populate("createdByUserId", "name email")
    .populate("assignedToUserId", "name email platformRole")
    .sort({ lastMessageAt: -1 })
    .lean();

  res.json({ success: true, conversations });
});

export const getPlatformSupportConversation = asyncHandler(async (req, res) => {
  const conversation = await SupportConversation.findById(req.params.conversationId)
    .populate("companyId", "name displayName slug")
    .populate("createdByUserId", "name email")
    .populate("assignedToUserId", "name email platformRole");

  if (!conversation) return res.status(404).json({ success: false, message: "Support conversation not found." });

  conversation.messages.forEach((message) => {
    if (message.senderType === "customer") message.readByPlatform = true;
  });
  await conversation.save();

  res.json({ success: true, conversation });
});

export const analyzePlatformSupportConversation = asyncHandler(async (req, res) => {
  const conversation = await SupportConversation.findById(req.params.conversationId);
  if (!conversation) return res.status(404).json({ success: false, message: "Support conversation not found." });

  try {
    await refreshAiAnalysis(conversation, { throwOnError: true });
    res.json({ success: true, conversation: serializeConversation(conversation) });
  } catch (error) {
    res.status(error?.status || 503).json({
      success: false,
      code: error?.code || "SUPPORT_AI_ERROR",
      message: error?.message || "AI analysis is unavailable.",
    });
  }
});

export const replyToPlatformSupportConversation = asyncHandler(async (req, res) => {
  const body = String(req.body.body || "").trim();
  if (!body) return res.status(400).json({ success: false, message: "Message is required." });

  const conversation = await SupportConversation.findById(req.params.conversationId);
  if (!conversation) return res.status(404).json({ success: false, message: "Support conversation not found." });

  conversation.messages.push({
    senderType: "agent",
    senderUserId: req.userId,
    senderName: req.platformUser?.name || req.platformUser?.email || "Terrapeak Support",
    body,
    readByCustomer: false,
    readByPlatform: true,
  });
  conversation.status = "waiting_customer";
  conversation.assignedToUserId = conversation.assignedToUserId || req.userId;
  conversation.lastMessageAt = new Date();
  await conversation.save();

  res.json({ success: true, conversation: serializeConversation(conversation) });
});

export const updatePlatformSupportConversation = asyncHandler(async (req, res) => {
  const allowedStatuses = new Set(["new", "needs_reply", "waiting_customer", "resolved"]);
  const allowedPriorities = new Set(["low", "normal", "high", "urgent"]);
  const allowedCategories = new Set(["api_key", "technical", "billing", "users", "apps", "general"]);
  const updates = {};

  if (req.body.status !== undefined) {
    if (!allowedStatuses.has(req.body.status)) return res.status(400).json({ success: false, message: "Invalid support status." });
    updates.status = req.body.status;
    updates.resolvedAt = req.body.status === "resolved" ? new Date() : null;
  }

  if (req.body.priority !== undefined) {
    if (!allowedPriorities.has(req.body.priority)) return res.status(400).json({ success: false, message: "Invalid support priority." });
    updates.priority = req.body.priority;
  }

  if (req.body.category !== undefined) {
    if (!allowedCategories.has(req.body.category)) return res.status(400).json({ success: false, message: "Invalid support category." });
    updates.category = req.body.category;
  }

  if (req.body.assignedToUserId !== undefined) {
    updates.assignedToUserId = await normalizePlatformAssignee(req.body.assignedToUserId);
  }

  const conversation = await SupportConversation.findByIdAndUpdate(req.params.conversationId, updates, { new: true, runValidators: true })
    .populate("companyId", "name displayName slug")
    .populate("createdByUserId", "name email")
    .populate("assignedToUserId", "name email platformRole");
  if (!conversation) return res.status(404).json({ success: false, message: "Support conversation not found." });

  res.json({ success: true, conversation });
});