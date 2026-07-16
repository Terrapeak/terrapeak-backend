import asyncHandler from "express-async-handler";
import SupportKnowledgeArticle from "../models/supportKnowledgeArticle.js";

const normalizeKeywords = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  return String(value || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
};

export const listSupportKnowledgeArticles = asyncHandler(async (req, res) => {
  const query