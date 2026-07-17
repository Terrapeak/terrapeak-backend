import asyncHandler from "express-async-handler";
import SupportConversation from "../models/supportConversation.js";
import SupportTask from "../models/supportTask.js";

const average = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

const countBy = (items, key, fallback = "unknown") => {
  const counts = {};
  items.forEach((item) => {
    const value = item?.[key] || fallback;
    counts[value] = (counts[value] || 0) + 1;
  });
  return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
};

const getFirstResponseMinutes = (conversation) => {
  const firstCustomerMessage = conversation.messages?.find((message) => message.senderType === "customer");
  if (!firstCustomerMessage?.createdAt) return null;
  const firstAgentReply = conversation.messages?.find((message) => message