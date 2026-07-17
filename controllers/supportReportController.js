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

export const getSupportReport = asyncHandler(async (req, res) => {
  const [conversations, tasks] = await Promise.all([
    SupportConversation.find({})
      .populate("assignedToUserId", "name email")
      .lean(),
    SupportTask.find({})
      .populate("assignedToUserId",