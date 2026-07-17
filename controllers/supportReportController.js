import asyncHandler from "express-async-handler";
import SupportConversation from "../models/supportConversation.js";
import SupportTask from "../models/supportTask.js";

const average = (values) => {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const countBy = (items, key, fallback = "unknown") => {
  const counts = {};
  items.forEach((item) => {
    const value = item?.[key] || fallback;
    counts[value] = (counts[value] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
};

const getFirstResponseMinutes = (conversation) => {
  const firstCustomerMessage = conversation.messages?.find(
    (message) => message.senderType === "customer"
  );
  if (!firstCustomerMessage?.createdAt) return null;

  const firstAgentReply = conversation.messages?.find(
    (message) =>
      message.senderType === "agent" &&
      new Date(message.createdAt).getTime() >= new Date(firstCustomerMessage.createdAt).getTime()
  );
  if (!firstAgentReply?.createdAt) return null;

  return Math.max(
    0,
    Math.round(
      (new Date(firstAgentReply.createdAt).getTime() -
        new Date(firstCustomerMessage.createdAt).getTime()) /
        60000
    )
  );
};

const getResolutionMinutes = (conversation) => {
  if (!conversation.resolvedAt || !conversation.createdAt) return null;
  return Math.max(
    0,
    Math.round(
      (new Date(conversation.resolvedAt).getTime() -
        new Date(conversation.createdAt).getTime()) /
        60000
    )
  );
};

export const getSupportReport = asyncHandler(async (req, res) => {
  const [conversations, tasks] = await Promise.all([
    SupportConversation.find({})
      .populate("assignedToUserId", "name email")
      .lean(),
    SupportTask.find({})
      .populate("assignedToUserId", "name email")
      .lean(),
  ]);

  const now = new Date();
  const openConversations = conversations.filter(
    (conversation) => conversation.status !== "resolved"
  );
  const unresolvedUnassigned = openConversations.filter(
    (conversation) => !conversation.assignedToUserId
  ).length;
  const unreadConversations = conversations.filter((conversation) =>
    conversation.messages?.some(
      (message) => message.senderType === "customer" && !message.readByPlatform
    )
  ).length;
  const activeTasks = tasks.filter((task) =>
    ["open", "in_progress"].includes(task.status)
  );
  const overdueTasks = activeTasks.filter(
    (task) => task.dueAt && new Date(task.dueAt).getTime() < now.getTime()
  );

  const firstResponseMinutes = conversations
    .map(getFirstResponseMinutes)
    .filter((value) => value !== null);
  const resolutionMinutes = conversations
    .map(getResolutionMinutes)
    .filter((value) => value !== null);

  const assigneeMap = new Map();
  const ensureAssignee = (assignee) => {
    const id = assignee?._id?.toString() || "unassigned";
    if (!assigneeMap.has(id)) {
      assigneeMap.set(id, {
        id,
        name: assignee?.name || assignee?.email || "Unassigned",
        openConversations: 0,
        activeTasks: 0,
        overdueTasks: 0,
      });
    }
    return assigneeMap.get(id);
  };

  openConversations.forEach((conversation) => {
    ensureAssignee(conversation.assignedToUserId).openConversations += 1;
  });
  activeTasks.forEach((task) => {
    const row = ensureAssignee(task.assignedToUserId);
    row.activeTasks += 1;
    if (task.dueAt && new Date(task.dueAt).getTime() < now.getTime()) {
      row.overdueTasks += 1;
    }
  });

  const workloadByAssignee = Array.from(assigneeMap.values()).sort(
    (a, b) =>
      b.openConversations + b.activeTasks - (a.openConversations + a.activeTasks)
  );

  res.json({
    success: true,
    report: {
      generatedAt: now,
      overview: {
        totalConversations: conversations.length,
        openConversations: openConversations.length,
        resolvedConversations: conversations.length - openConversations.length,
        unreadConversations,
        unresolvedUnassigned,
        activeTasks: activeTasks.length,
        overdueTasks: overdueTasks.length,
        averageFirstResponseMinutes: average(firstResponseMinutes),
        averageResolutionMinutes: average(resolutionMinutes),
        firstResponseSampleSize: firstResponseMinutes.length,
        resolutionSampleSize: resolutionMinutes.length,
      },
      conversationsByCategory: countBy(conversations, "category", "general"),
      conversationsByPriority: countBy(conversations, "priority", "normal"),
      conversationsByStatus: countBy(conversations, "status", "unknown"),
      tasksByStatus: countBy(tasks, "status", "unknown"),
      workloadByAssignee,
    },
  });
});
