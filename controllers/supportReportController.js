import asyncHandler from "express-async-handler";
import SupportConversation from "../models/supportConversation.js";
import SupportTask from "../models/supportTask.js";

const average = (values) => {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const countBy = (items, key, fallback = "unknown") =>