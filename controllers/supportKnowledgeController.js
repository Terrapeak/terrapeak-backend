import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import SupportKnowledgeArticle from "../models/supportKnowledgeArticle.js";

const ALLOWED_CATEGORIES = new Set([
  "api_key",
  "technical",
  "billing",
  "users",
  "apps",
  "general",
]);

const normalizeKeywords = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

const normalizeCategory = (value) => String(value || "general").trim().toLowerCase();

const validateArticleInput = ({ title, category, content }) => {
  if (!String(title || "").trim()) return "Title is required.";
  if (!String(content || "").trim()) return "Content is required.";
  if (!ALLOWED_CATEGORIES.has(category)) return "Invalid category.";
  return null;
};

const getUpdatedByUserId = (req) => {
  const candidate = req.platformUser?._id || req.userId;
  return mongoose.Types.ObjectId.isValid(candidate) ? candidate : null;
};

const sendKnowledgeError = (res, error, fallbackMessage) => {
  console.error("Support knowledge error:", error);

  if (error?.name === "ValidationError") {
    const message = Object.values(error.errors || {})
      .map((item) => item.message)
      .filter(Boolean)
      .join(" ");
    return res.status(400).json({ success: false, message: message || fallbackMessage });
  }

  if (error?.code === 11000) {
    return res.status(409).json({ success: false, message: "A knowledge article with conflicting data already exists." });
  }

  return res.status(500).json({
    success: false,
    message: error?.message || fallbackMessage,
  });
};

export const listSupportKnowledgeArticles = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.category && req.query.category !== "all") {
    query.category = normalizeCategory(req.query.category);
  }
  if (req.query.active === "true") query.isActive = true;
  if (req.query.active === "false") query.isActive = false;

  const articles = await SupportKnowledgeArticle.find(query)
    .sort({ updatedAt: -1 })
    .lean();

  res.json({ success: true, articles });
});

export const createSupportKnowledgeArticle = asyncHandler(async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const category = normalizeCategory(req.body?.category);
  const content = String(req.body?.content || "").trim();
  const validationError = validateArticleInput({ title, category, content });

  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  try {
    const article = await SupportKnowledgeArticle.create({
      title,
      category,
      content,
      keywords: normalizeKeywords(req.body?.keywords),
      isActive: req.body?.isActive !== false,
      updatedByUserId: getUpdatedByUserId(req),
    });

    return res.status(201).json({ success: true, article });
  } catch (error) {
    return sendKnowledgeError(res, error, "Unable to create knowledge article.");
  }
});

export const updateSupportKnowledgeArticle = asyncHandler(async (req, res) => {
  const article = await SupportKnowledgeArticle.findById(req.params.articleId);
  if (!article) {
    return res.status(404).json({ success: false, message: "Knowledge article not found." });
  }

  const title = req.body?.title !== undefined ? String(req.body.title).trim() : article.title;
  const category = req.body?.category !== undefined ? normalizeCategory(req.body.category) : article.category;
  const content = req.body?.content !== undefined ? String(req.body.content).trim() : article.content;
  const validationError = validateArticleInput({ title, category, content });

  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  try {
    article.title = title;
    article.category = category;
    article.content = content;
    if (req.body?.keywords !== undefined) article.keywords = normalizeKeywords(req.body.keywords);
    if (req.body?.isActive !== undefined) article.isActive = Boolean(req.body.isActive);
    article.updatedByUserId = getUpdatedByUserId(req);
    await article.save();

    return res.json({ success: true, article });
  } catch (error) {
    return sendKnowledgeError(res, error, "Unable to update knowledge article.");
  }
});

export const deleteSupportKnowledgeArticle = asyncHandler(async (req, res) => {
  const article = await SupportKnowledgeArticle.findByIdAndDelete(req.params.articleId);
  if (!article) {
    return res.status(404).json({ success: false, message: "Knowledge article not found." });
  }

  res.json({ success: true, message: "Knowledge article deleted." });
});
