import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import CompanyMembership from "../models/companyMembership.js";
import SupportConversation from "../models/supportConversation.js";
import SupportInternalNote from "../models/supportInternalNote.js";
import SupportNotification from "../models/supportNotification.js";
import SupportTask from "../models/supportTask.js";
import User from "../models/user.js";
import { analyzeSupportConversation } from "../services/supportAiService.js";
import { buildSupportCompanyContext } from "../services/supportContextService.js";
import { findRelevantSupportKnowledge } from "../services/supportKnowledgeService.js";
import { attachConversationSla } from "../services/supportSlaService.js";
import { createAutomaticSupportReply } from "../services/supportSelfServiceService.js";
import { handleSupportAccountAction } from "../services/supportAccountActionService.js";
import { handleSupportClarification } from "../services/supportClarificationService.js";
import { handleSupportCompanyUpdate } from "../services/supportCompanyUpdateService.js";
import { handleSupportUserCreation } from "../services/supportUserCreationService.js";
import { handleSupportUserRemoval } from "../services/supportUserRemovalService.js";
import { handleSupportUserUpdate } from "../services/supportUserUpdateService.js";

const PLATFORM_ROLES = ["platform-owner", "platform-admin", "support-admin", "billing-admin", "developer-admin", "sales-admin", "viewer"];
const PERMANENT_DELETE_ROLES = new Set(["platform-owner", "platform-admin"]);
const getActiveMembership = (userId) => CompanyMembership.findOne({ userId, isActive: true });

const normalizePlatformAssignee = async (value) => {
  if (!value) return null;
  if (!mongoose.Types.ObjectId.isValid(value)) { const error = new Error("Invalid assignee."); error.status = 400; throw error; }
  const user = await User.findOne({ _id: value, platformRole: { $in: PLATFORM_ROLES }, accountStatus: { $ne: "removed" } }).select("_id");
  if (!user) { const error = new Error("Selected assignee is not an active platform user."); error.status = 400; throw error; }
  return user._id;
};

const serializeConversation = (conversation) => attachConversationSla({
  _id: conversation._id, companyId: conversation.companyId, createdByUserId: conversation.createdByUserId,
  subject: conversation.subject, category: conversation.category, priority: conversation.priority,
  status: conversation.status, assignedToUserId: conversation.assignedToUserId, messages: conversation.messages,
  aiAnalysis: conversation.aiAnalysis, pendingAction: conversation.pendingAction, lastMessageAt: conversation.lastMessageAt,
  resolvedAt: conversation.resolvedAt, customerHiddenAt: conversation.customerHiddenAt,
  archivedAt: conversation.archivedAt, archivedByUserId: conversation.archivedByUserId,
  createdAt: conversation.createdAt, updatedAt: conversation.updatedAt,
});

const markCustomerMessagesRead = (conversation) => {
  let changed = false;
  conversation.messages.forEach((message) => { if (message.senderType === "customer" && !message.readByPlatform) { message.readByPlatform = true; changed = true; } });
  return changed;
};

const appendAssistantReply = async (conversation, body, { category = null } = {}) => {
  markCustomerMessagesRead(conversation);
  conversation.messages.push({ senderType: "agent", senderUserId: null, senderName: "Terrapeak Support Assistant", body, readByCustomer: false, readByPlatform: true });
  if (category) conversation.category = category;
  conversation.status = "waiting_customer";
  conversation.aiAnalysis = null;
  conversation.lastMessageAt = new Date();
  await conversation.save();
};

const runCustomerAutomation = async ({ conversation, requestBody, membership, user }) => {
  try {
    const handlers = [
      [handleSupportClarification, "users"],
      [handleSupportUserCreation, "users"],
      [handleSupportUserRemoval, "users"],
      [handleSupportUserUpdate, "users"],
      [handleSupportCompanyUpdate, "general"],
      [handleSupportAccountAction, "users"],
    ];
    for (const [handler, category] of handlers) {
      const result = await handler({ conversation, requesterMembership: membership, requester: user, body: requestBody });
      if (result?.handled) { await appendAssistantReply(conversation, result.body, { category }); return true; }
    }
    const automaticReply = await createAutomaticSupportReply({ companyId: conversation.companyId, subject: conversation.subject, body: requestBody });
    if (!automaticReply) return false;
    const category = automaticReply.intent === "account_billing_info" ? "billing" : automaticReply.intent === "user_info" ? "users" : automaticReply.intent === "app_info" ? "apps" : "general";
    await appendAssistantReply(conversation, automaticReply.body, { category });
    return true;
  } catch (error) {
    console.error("Customer support automation failed:", error?.message || error);
    return false;
  }
};

const refreshAiAnalysis = async (conversation, { throwOnError = false } = {}) => {
  try {
    const [companyContext, knowledgeContext] = await Promise.all([
      buildSupportCompanyContext(conversation.companyId),
      findRelevantSupportKnowledge({ subject: conversation.subject, messages: conversation.messages }),
    ]);
    const analysis = await analyzeSupportConversation({ subject: conversation.subject, messages: conversation.messages, companyContext, knowledgeContext });
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
  const conversations = await SupportConversation.find({ companyId: membership.companyId, customerHiddenAt: null }).select("-aiAnalysis").sort({ lastMessageAt: -1 }).lean();
  res.json({ success: true, conversations });
});

export const createSupportConversation = asyncHandler(async (req, res) => {
  const membership = await getActiveMembership(req.userId);
  if (!membership) return res.status(404).json({ success: false, message: "No active company membership found." });
  const user = await User.findById(req.userId).select("name email phone");
  const subject = String(req.body.subject || "").trim();
  const body = String(req.body.body || "").trim();
  if (!subject || !body) return res.status(400).json({ success: false, message: "Subject and message are required." });
  const conversation = await SupportConversation.create({ companyId: membership.companyId, createdByUserId: req.userId, subject, category: req.body.category || "general", priority: req.body.priority || "normal", status: "new", messages: [{ senderType: "customer", senderUserId: req.userId, senderName: user?.name || user?.email || "Customer", body, readByCustomer: true, readByPlatform: false }], lastMessageAt: new Date() });
  const handled = await runCustomerAutomation({ conversation, requestBody: body, membership, user });
  if (!handled) await refreshAiAnalysis(conversation);
  res.status(201).json({ success: true, conversation: serializeConversation(conversation), automaticallyHandled: handled });
});

export const replyToMySupportConversation = asyncHandler(async (req, res) => {
  const membership = await getActiveMembership(req.userId);
  if (!membership) return res.status(404).json({ success: false, message: "No active company membership found." });
  const body = String(req.body.body || "").trim();
  if (!body) return res.status(400).json({ success: false, message: "Message is required." });
  const user = await User.findById(req.userId).select("name email phone");
  const conversation = await SupportConversation.findOne({ _id: req.params.conversationId, companyId: membership.companyId, customerHiddenAt: null, archivedAt: null });
  if (!conversation) return res.status(404).json({ success: false, message: "Support conversation not found." });
  conversation.messages.push({ senderType: "customer", senderUserId: req.userId, senderName: user?.name || user?.email || "Customer", body, readByCustomer: true, readByPlatform: false });
  conversation.status = "needs_reply"; conversation.lastMessageAt = new Date(); conversation.resolvedAt = null; await conversation.save();
  const handled = await runCustomerAutomation({ conversation, requestBody: body, membership, user });
  if (!handled) await refreshAiAnalysis(conversation);
  res.json({ success: true, conversation: serializeConversation(conversation), automaticallyHandled: handled });
});

export const hideMySupportConversation = asyncHandler(async (req, res) => {
  const membership = await getActiveMembership(req.userId);
  if (!membership) return res.status(404).json({ success: false, message: "No active company membership found." });
  const conversation = await SupportConversation.findOneAndUpdate(
    { _id: req.params.conversationId, companyId: membership.companyId, customerHiddenAt: null },
    { $set: { customerHiddenAt: new Date(), customerHiddenByUserId: req.userId } },
    { new: true },
  );
  if (!conversation) return res.status(404).json({ success: false, message: "Support conversation not found." });
  res.json({ success: true });
});

export const listPlatformSupportConversations = asyncHandler(async (req, res) => {
  const query = req.query.status === "archived" ? { archivedAt: { $ne: null } } : { archivedAt: null };
  if (req.query.status && !["all", "archived"].includes(req.query.status)) query.status = req.query.status;
  if (req.query.assignee === "unassigned") query.assignedToUserId = null;
  else if (req.query.assignee && req.query.assignee !== "all" && mongoose.Types.ObjectId.isValid(req.query.assignee)) query.assignedToUserId = req.query.assignee;
  const conversations = await SupportConversation.find(query).populate("companyId", "name displayName slug").populate("createdByUserId", "name email").populate("assignedToUserId", "name email platformRole").sort({ lastMessageAt: -1 }).lean();
  res.json({ success: true, conversations: conversations.map((conversation) => attachConversationSla(conversation)) });
});

export const getPlatformSupportConversation = asyncHandler(async (req, res) => {
  const conversation = await SupportConversation.findById(req.params.conversationId).populate("companyId", "name displayName slug").populate("createdByUserId", "name email").populate("assignedToUserId", "name email platformRole");
  if (!conversation) return res.status(404).json({ success: false, message: "Support conversation not found." });
  if (markCustomerMessagesRead(conversation)) await conversation.save();
  res.json({ success: true, conversation: attachConversationSla(conversation.toObject()) });
});

export const markAllPlatformSupportConversationsRead = asyncHandler(async (req, res) => {
  const result = await SupportConversation.updateMany({ archivedAt: null, messages: { $elemMatch: { senderType: "customer", readByPlatform: { $ne: true } } } }, { $set: { "messages.$[message].readByPlatform": true } }, { arrayFilters: [{ "message.senderType": "customer", "message.readByPlatform": { $ne: true } }] });
  res.json({ success: true, modifiedCount: result.modifiedCount || 0 });
});

export const analyzePlatformSupportConversation = asyncHandler(async (req, res) => {
  const conversation = await SupportConversation.findOne({ _id: req.params.conversationId, archivedAt: null });
  if (!conversation) return res.status(404).json({ success: false, message: "Support conversation not found." });
  try { await refreshAiAnalysis(conversation, { throwOnError: true }); res.json({ success: true, conversation: serializeConversation(conversation) }); }
  catch (error) { res.status(error?.status || 503).json({ success: false, code: error?.code || "SUPPORT_AI_ERROR", message: error?.message || "AI analysis is unavailable." }); }
});

export const replyToPlatformSupportConversation = asyncHandler(async (req, res) => {
  const body = String(req.body.body || "").trim();
  if (!body) return res.status(400).json({ success: false, message: "Message is required." });
  const conversation = await SupportConversation.findOne({ _id: req.params.conversationId, archivedAt: null });
  if (!conversation) return res.status(404).json({ success: false, message: "Support conversation not found." });
  markCustomerMessagesRead(conversation);
  conversation.messages.push({ senderType: "agent", senderUserId: req.userId, senderName: req.platformUser?.name || req.platformUser?.email || "Terrapeak Support", body, readByCustomer: false, readByPlatform: true });
  conversation.status = "waiting_customer";
  const newlyAssigned = !conversation.assignedToUserId;
  conversation.assignedToUserId = conversation.assignedToUserId || req.userId;
  conversation.lastMessageAt = new Date();
  await conversation.save();
  if (newlyAssigned && conversation.assignedToUserId) await SupportTask.updateMany({ conversationId: conversation._id, assignedToUserId: null, status: { $in: ["open", "in_progress"] } }, { $set: { assignedToUserId: conversation.assignedToUserId } });
  res.json({ success: true, conversation: serializeConversation(conversation) });
});

export const updatePlatformSupportConversation = asyncHandler(async (req, res) => {
  const allowedStatuses = new Set(["new", "needs_reply", "waiting_customer", "resolved"]);
  const allowedPriorities = new Set(["low", "normal", "high", "urgent"]);
  const allowedCategories = new Set(["api_key", "technical", "billing", "users", "apps", "general"]);
  const updates = {}; let normalizedAssignee; let hasAssigneeUpdate = false;
  if (req.body.status !== undefined) { if (!allowedStatuses.has(req.body.status)) return res.status(400).json({ success: false, message: "Invalid support status." }); updates.status = req.body.status; updates.resolvedAt = req.body.status === "resolved" ? new Date() : null; }
  if (req.body.priority !== undefined) { if (!allowedPriorities.has(req.body.priority)) return res.status(400).json({ success: false, message: "Invalid support priority." }); updates.priority = req.body.priority; }
  if (req.body.category !== undefined) { if (!allowedCategories.has(req.body.category)) return res.status(400).json({ success: false, message: "Invalid support category." }); updates.category = req.body.category; }
  if (req.body.assignedToUserId !== undefined) { normalizedAssignee = await normalizePlatformAssignee(req.body.assignedToUserId); updates.assignedToUserId = normalizedAssignee; hasAssigneeUpdate = true; }
  const conversation = await SupportConversation.findOneAndUpdate({ _id: req.params.conversationId, archivedAt: null }, updates, { new: true, runValidators: true }).populate("companyId", "name displayName slug").populate("createdByUserId", "name email").populate("assignedToUserId", "name email platformRole");
  if (!conversation) return res.status(404).json({ success: false, message: "Support conversation not found." });
  if (hasAssigneeUpdate && normalizedAssignee) await SupportTask.updateMany({ conversationId: conversation._id, assignedToUserId: null, status: { $in: ["open", "in_progress"] } }, { $set: { assignedToUserId: normalizedAssignee } });
  res.json({ success: true, conversation: attachConversationSla(conversation.toObject()) });
});

export const archivePlatformSupportConversation = asyncHandler(async (req, res) => {
  const conversation = await SupportConversation.findOneAndUpdate(
    { _id: req.params.conversationId, archivedAt: null },
    { $set: { archivedAt: new Date(), archivedByUserId: req.userId } },
    { new: true },
  );
  if (!conversation) return res.status(404).json({ success: false, message: "Support conversation not found or already archived." });
  res.json({ success: true, conversation: serializeConversation(conversation) });
});

export const restorePlatformSupportConversation = asyncHandler(async (req, res) => {
  const conversation = await SupportConversation.findOneAndUpdate(
    { _id: req.params.conversationId, archivedAt: { $ne: null } },
    { $set: { archivedAt: null, archivedByUserId: null } },
    { new: true },
  );
  if (!conversation) return res.status(404).json({ success: false, message: "Archived support conversation not found." });
  res.json({ success: true, conversation: serializeConversation(conversation) });
});

export const permanentlyDeletePlatformSupportConversation = asyncHandler(async (req, res) => {
  if (!PERMANENT_DELETE_ROLES.has(req.platformUser?.platformRole)) {
    return res.status(403).json({ success: false, message: "Only platform owners and platform admins can permanently delete conversations." });
  }
  const conversation = await SupportConversation.findOne({ _id: req.params.conversationId, archivedAt: { $ne: null } }).select("_id");
  if (!conversation) return res.status(404).json({ success: false, message: "Archive the conversation before deleting it permanently." });
  const tasks = await SupportTask.find({ conversationId: conversation._id }).select("_id").lean();
  const taskIds = tasks.map((task) => task._id);
  await Promise.all([
    SupportInternalNote.deleteMany({ conversationId: conversation._id }),
    SupportNotification.deleteMany({ $or: [{ conversationId: conversation._id }, ...(taskIds.length ? [{ taskId: { $in: taskIds } }] : [])] }),
    SupportTask.deleteMany({ conversationId: conversation._id }),
    SupportConversation.deleteOne({ _id: conversation._id }),
  ]);
  res.json({ success: true });
});
