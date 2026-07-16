import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import ChatbotSettings from "../models/chatbotSettings.js";

const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
]);

const ACTIVITY_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 12000;

const maskKey = (value = "") => {
  const key = String(value || "");
  if (!key) return null;
  const ending = key.slice(-4);
  return `••••••••${ending}`;
};

const appendActivity = async ({ companyId, actor, model, keyReplaced }) => {
  await Company.updateOne(
    { _id: companyId },
    {
      $push: {
        activity