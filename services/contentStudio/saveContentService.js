import mongoose from "mongoose";
import ContentStudioContent from "../../models/contentStudioContent.js";

const ensureObjectId = (value, fieldName) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    const error = new Error(`A valid ${fieldName} is required.`);
    error.statusCode = 400;
    throw error;
  }

  return value;
};

const normalizeString = (value, fallback = "") =>
  typeof value === "string" ? value.trim() : fallback;

const normalizeStringList = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
};

const normalizeBrief = (brief = {}) => ({
  goal: normalizeString(brief.goal),
  topic: normalizeString(brief.topic),
  audience: normalizeString(brief.audience),
  tone: normalizeString(brief.tone),
  length: normalizeString(brief.length),
  keyPoints: normalizeStringList(brief.keyPoints),
  keywords: normalizeStringList(brief.keywords),
  callToAction: normalizeString(brief.callToAction),
});

const normalizeGenerationMetadata = (metadata = {}) => ({
  provider: normalizeString(metadata.provider, "gemini") || "gemini",
  model: normalizeString(metadata.model),
  generatedAt: metadata.generatedAt
    ? new Date(metadata.generatedAt)
    : new Date(),
  generationId: normalizeString(metadata.generationId),
});

const buildContentPayload = ({
  companyId,
  userId,
  title,
  summary,
  content,
  contentType,
  status,
  brief,
  generationMetadata,
}) => {
  ensureObjectId(companyId, "company ID");
  ensureObjectId(userId, "user ID");

  const normalizedTitle = normalizeString(title);
  const normalizedContent = normalizeString(content);
  const normalizedContentType =
    normalizeString(contentType, "general").toLowerCase() || "general";

  if (!normalizedTitle) {
    const error = new Error("A title is required.");
    error.statusCode = 400;
    throw error;
  }

  if (!normalizedContent) {
    const error = new Error("Content cannot be empty.");
    error.statusCode = 400;
    throw error;
  }

  return {
    companyId,
    createdByUserId: userId,
    lastEditedByUserId: userId,
    title: normalizedTitle,
    summary: normalizeString(summary),
    content: normalizedContent,
    contentType: normalizedContentType,
    status: ["draft", "final", "archived"].includes(status)
      ? status
      : "draft",
    brief: normalizeBrief(brief),
    generationMetadata: normalizeGenerationMetadata(
      generationMetadata,
    ),
  };
};

export const saveContent = async (input) => {
  const payload = buildContentPayload(input);

  return ContentStudioContent.create(payload);
};

export const getContentLibrary = async ({
  companyId,
  page = 1,
  limit = 20,
  search = "",
  status,
  contentType,
  sort = "updatedAt",
  order = "desc",
}) => {
  ensureObjectId(companyId, "company ID");

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const query = {
    companyId,
  };

  if (status && ["draft", "final", "archived"].includes(status)) {
    query.status = status;
  }

  if (contentType) {
    query.contentType = normalizeString(contentType).toLowerCase();
  }

  const normalizedSearch = normalizeString(search);

  if (normalizedSearch) {
    query.$or = [
      {
        title: {
          $regex: normalizedSearch,
          $options: "i",
        },
      },
      {
        summary: {
          $regex: normalizedSearch,
          $options: "i",
        },
      },
      {
        content: {
          $regex: normalizedSearch,
          $options: "i",
        },
      },
    ];
  }

  const allowedSortFields = new Set([
    "createdAt",
    "updatedAt",
    "title",
    "contentType",
    "status",
  ]);

  const sortField = allowedSortFields.has(sort)
    ? sort
    : "updatedAt";

  const sortDirection = order === "asc" ? 1 : -1;

  const [items, total] = await Promise.all([
    ContentStudioContent.find(query)
      .sort({ [sortField]: sortDirection })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ContentStudioContent.countDocuments(query),
  ]);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(Math.ceil(total / safeLimit), 1),
    },
  };
};

export const getContentById = async ({
  companyId,
  contentId,
}) => {
  ensureObjectId(companyId, "company ID");
  ensureObjectId(contentId, "content ID");

  return ContentStudioContent.findOne({
    _id: contentId,
    companyId,
  }).lean();
};

export const updateContent = async ({
  companyId,
  userId,
  contentId,
  updates,
}) => {
  ensureObjectId(companyId, "company ID");
  ensureObjectId(userId, "user ID");
  ensureObjectId(contentId, "content ID");

  const allowedUpdates = {};

  if (typeof updates.title === "string") {
    const title = updates.title.trim();

    if (!title) {
      const error = new Error("A title is required.");
      error.statusCode = 400;
      throw error;
    }

    allowedUpdates.title = title;
  }

  if (typeof updates.summary === "string") {
    allowedUpdates.summary = updates.summary.trim();
  }

  if (typeof updates.content === "string") {
    const content = updates.content.trim();

    if (!content) {
      const error = new Error("Content cannot be empty.");
      error.statusCode = 400;
      throw error;
    }

    allowedUpdates.content = content;
  }

  if (typeof updates.contentType === "string") {
    allowedUpdates.contentType =
      updates.contentType.trim().toLowerCase();
  }

  if (
    typeof updates.status === "string" &&
    ["draft", "final", "archived"].includes(updates.status)
  ) {
    allowedUpdates.status = updates.status;
  }

  if (updates.brief && typeof updates.brief === "object") {
    allowedUpdates.brief = normalizeBrief(updates.brief);
  }

  allowedUpdates.lastEditedByUserId = userId;

  return ContentStudioContent.findOneAndUpdate(
    {
      _id: contentId,
      companyId,
    },
    {
      $set: allowedUpdates,
    },
    {
      new: true,
      runValidators: true,
    },
  ).lean();
};

export const deleteContent = async ({
  companyId,
  contentId,
}) => {
  ensureObjectId(companyId, "company ID");
  ensureObjectId(contentId, "content ID");

  return ContentStudioContent.findOneAndDelete({
    _id: contentId,
    companyId,
  }).lean();
};