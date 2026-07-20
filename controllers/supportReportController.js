import asyncHandler from "express-async-handler";
import SupportConversation from "../models/supportConversation.js";
import SupportTask from "../models/supportTask.js";
import { calculateConversationSla, SUPPORT_SLA_TARGETS } from "../services/supportSlaService.js";

const avg = (values) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
const countBy = (items, key, fallback = "unknown") => {
  const counts = {};
  items.forEach((item) => {
    const value = item?.[key] || fallback;
    counts[value] = (counts[value] || 0) + 1;
  });
  return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
};
const firstResponse = (conversation) => {
  const customer = conversation.messages?.find((message) => message.senderType === "customer");
  const agent = conversation.messages?.find((message) => message.senderType === "agent" && customer?.createdAt && new Date(message.createdAt) >= new Date(customer.createdAt));
  return customer?.createdAt && agent?.createdAt ? Math.max(0, Math.round((new Date(agent.createdAt) - new Date(customer.createdAt)) / 60000)) : null;
};
const resolutionTime = (conversation) => conversation.resolvedAt && conversation.createdAt
  ? Math.max(0, Math.round((new Date(conversation.resolvedAt) - new Date(conversation.createdAt)) / 60000))
  : null;
const inRange = (date, start, end) => date && new Date(date) >= start && new Date(date) < end;
const comparison = (current, previous) => ({ current, previous, change: previous ? Math.round(((current - previous) / previous) * 100) : null });

export const getSupportReport = asyncHandler(async (req, res) => {
  const allowed = new Set(["7", "30", "90", "all"]);
  const period = allowed.has(String(req.query.period)) ? String(req.query.period) : "30";
  const [conversations, tasks] = await Promise.all([
    SupportConversation.find({}).populate("assignedToUserId", "name email").lean(),
    SupportTask.find({}).populate("assignedToUserId", "name email").lean(),
  ]);

  const now = new Date();
  const days = period === "all" ? null : Number(period);
  const start = days ? new Date(now.getTime() - days * 86400000) : null;
  const previousStart = days ? new Date(start.getTime() - days * 86400000) : null;
  const currentConversations = days ? conversations.filter((item) => inRange(item.createdAt, start, now)) : conversations;
  const previousConversations = days ? conversations.filter((item) => inRange(item.createdAt, previousStart, start)) : [];
  const currentDoneTasks = days ? tasks.filter((item) => item.status === "done" && inRange(item.completedAt || item.updatedAt, start, now)) : tasks.filter((item) => item.status === "done");
  const previousDoneTasks = days ? tasks.filter((item) => item.status === "done" && inRange(item.completedAt || item.updatedAt, previousStart, start)) : [];

  const openConversations = conversations.filter((item) => item.status !== "resolved");
  const unreadConversations = conversations.filter((item) => item.messages?.some((message) => message.senderType === "customer" && !message.readByPlatform)).length;
  const activeTasks = tasks.filter((item) => ["open", "in_progress"].includes(item.status));
  const doneTasks = tasks.filter((item) => item.status === "done");
  const overdueTasks = activeTasks.filter((item) => item.dueAt && new Date(item.dueAt) < now);
  const currentResponses = currentConversations.map(firstResponse).filter((value) => value !== null);
  const currentResolutions = currentConversations.map(resolutionTime).filter((value) => value !== null);
  const previousResponses = previousConversations.map(firstResponse).filter((value) => value !== null);
  const previousResolutions = previousConversations.map(resolutionTime).filter((value) => value !== null);

  const slaRows = conversations.map((conversation) => ({ conversation, sla: calculateConversationSla(conversation, now) }));
  const slaBreached = slaRows.filter((row) => row.sla.state === "breached");
  const slaDueSoon = slaRows.filter((row) => row.sla.state === "due_soon");
  const responseBreached = slaRows.filter((row) => row.sla.firstResponse.breached);
  const resolutionBreached = slaRows.filter((row) => row.sla.resolution.breached);

  const assignees = new Map();
  const rowFor = (assignee) => {
    const id = assignee?._id?.toString() || "unassigned";
    if (!assignees.has(id)) assignees.set(id, { id, name: assignee?.name || assignee?.email || "Unassigned", openConversations: 0, activeTasks: 0, overdueTasks: 0, doneTasks: 0 });
    return assignees.get(id);
  };
  openConversations.forEach((item) => rowFor(item.assignedToUserId).openConversations += 1);
  activeTasks.forEach((item) => {
    const row = rowFor(item.assignedToUserId);
    row.activeTasks += 1;
    if (item.dueAt && new Date(item.dueAt) < now) row.overdueTasks += 1;
  });
  doneTasks.forEach((item) => rowFor(item.assignedToUserId).doneTasks += 1);

  res.json({ success: true, report: {
    generatedAt: now,
    period: { value: period, days, start, end: now },
    overview: {
      totalConversations: conversations.length,
      openConversations: openConversations.length,
      resolvedConversations: conversations.length - openConversations.length,
      unreadConversations,
      unresolvedUnassigned: openConversations.filter((item) => !item.assignedToUserId).length,
      activeTasks: activeTasks.length,
      doneTasks: doneTasks.length,
      overdueTasks: overdueTasks.length,
      averageFirstResponseMinutes: avg(currentResponses),
      averageResolutionMinutes: avg(currentResolutions),
      firstResponseSampleSize: currentResponses.length,
      resolutionSampleSize: currentResolutions.length,
      slaBreached: slaBreached.length,
      slaDueSoon: slaDueSoon.length,
      firstResponseBreached: responseBreached.length,
      resolutionBreached: resolutionBreached.length,
    },
    slaTargets: SUPPORT_SLA_TARGETS,
    periodMetrics: {
      newConversations: comparison(currentConversations.length, previousConversations.length),
      completedTasks: comparison(currentDoneTasks.length, previousDoneTasks.length),
      averageFirstResponseMinutes: comparison(avg(currentResponses) || 0, avg(previousResponses) || 0),
      averageResolutionMinutes: comparison(avg(currentResolutions) || 0, avg(previousResolutions) || 0),
    },
    conversationsByCategory: countBy(currentConversations, "category", "general"),
    conversationsByPriority: countBy(currentConversations, "priority", "normal"),
    conversationsByStatus: countBy(currentConversations, "status", "unknown"),
    tasksByStatus: countBy(days ? tasks.filter((item) => inRange(item.createdAt, start, now) || inRange(item.completedAt, start, now)) : tasks, "status", "unknown"),
    slaByState: [
      { name: "on_track", count: slaRows.filter((row) => row.sla.state === "on_track").length },
      { name: "due_soon", count: slaDueSoon.length },
      { name: "breached", count: slaBreached.length },
    ],
    workloadByAssignee: Array.from(assignees.values()).sort((a, b) => (b.openConversations + b.activeTasks) - (a.openConversations + a.activeTasks)),
  }});
});
