import asyncHandler from "express-async-handler";
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

const validateArticleInput = ({ title, category, content }) => {
  if (!String(title || "").trim()) return "Title is required.";
  if (!String(content || "").trim()) return "Content is required.";
  if (!ALLOWED_CATEGORIES.has(category || "general")) return "Invalid category.";
  return null;
};

export const listSupportKnowledgeArticles = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.category && req.query.category !== "all") {
    query.category = req.query.category;
  }
  if (req.query.active === "true") query.isActive = true;
  if (req.query.active === "false") query.isActive = false;

  const articles = await SupportKnowledgeArticle.find(query)
    .sort({ updatedAt: -1 })
    .lean();

  res.json({ success: true, articles });
});

export const createSupportKnowledgeArticle = asyncHandler(async (req, res) => {
  const title = String(req.body.title || "").trim();
  const category = String(req.body.category || "general").trim();
  const content = String(req.body.content || "").trim();
  const validationError = validateArticleInput({ title, category, content });

  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const article = await SupportKnowledgeArticle.create({
    title,
    category,
    content,
    keywords: normalizeKeywords(req.body.keywords),
    isActive: req.body.isActive !== false,
    updatedByUserId: req.userId,
  });

  res.status(201).json({ success: true, article });
});

export const updateSupportKnowledgeArticle = asyncHandler(async (req, res) => {
  const article = await SupportKnowledgeArticle.findById(req.params.articleId);
  if (!article) {
    return res.status(404).json({ success: false, message: "Knowledge article not found." });
  }

  const title = req.body.title !== undefined ? String(req.body.title).trim() : article.title;
  const category = req.body.category !== undefined ? String(req.body.category).trim() : article.category;
  const content = req.body.content !== undefined ? String(req.body.content).trim() : article.content;
  const validationError = validateArticleInput({ title, category, content });

  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  article.title = title;
  article.category = category;
  article.content = content;
  if (req.body.keywords !== undefined) article.keywords = normalizeKeywords(req.body.keywords);
  if (req.body.isActive !== undefined) article.isActive = Boolean(req.body.isActive);
  article.updatedByUserId = req.userId;
  await article.save();

  res.json({ success: true, article });
});

export const deleteSupportKnowledgeArticle = asyncHandler(async (req, res) => {
  const article = await SupportKnowledgeArticle.findByIdAndDelete(req.params.articleId);
  if (!article) {
    return res.status(404).json({ success: false, message: "Knowledge article not found." });
  }

  res.json({ success: true, message: "Knowledge article deleted." });
});
