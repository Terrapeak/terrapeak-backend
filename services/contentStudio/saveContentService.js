import mongoose from "mongoose";
import ContentStudioContent from "../../models/contentStudioContent.js";
import ContentStudioImageAsset from "../../models/contentStudioImageAsset.js";
import { validateCompanyImages } from "./imageOwnershipService.js";
import { recordImageAudit } from "./imageAuditService.js";

const ASSET_REFERENCE_PATTERN = /!\[([^\]]*)\]\(asset:([a-f0-9]{24})\)(?:\{([^}]*)\})?/gi;

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

const normalizeImages = (images) => {
  if (!Array.isArray(images)) return [];
  return images.slice(0, 30).filter((item) =>
    item?.assetId && mongoose.Types.ObjectId.isValid(item.assetId)
  ).map((item, index) => ({
    assetId: item.assetId,
    position: ["cover", "after-heading", "after-paragraph", "inline", "manual"].includes(item.position)
      ? item.position : "manual",
    anchor: normalizeString(item.anchor).slice(0, 500),
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
    altText: normalizeString(item.altText).slice(0, 500),
    caption: normalizeString(item.caption).slice(0, 1000),
    approved: item.approved !== false,
  }));
};

const parseImageOptions = (raw = "") => {
  const options = {};

  String(raw)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return;
      const key = part.slice(0, separator).trim();
      let value = part.slice(separator + 1).trim();
      try {
        value = decodeURIComponent(value);
      } catch {
        // Keep legacy values that were not URI encoded.
      }
      options[key] = value;
    });

  return options;
};

const extractImagesFromContent = (content, fallbackImages = []) => {
  const fallbackById = new Map(
    normalizeImages(fallbackImages).map((image) => [String(image.assetId), image]),
  );
  const references = [];
  const seen = new Set();
  const source = String(content || "");
  ASSET_REFERENCE_PATTERN.lastIndex = 0;

  let match;
  while ((match = ASSET_REFERENCE_PATTERN.exec(source)) && references.length < 30) {
    const assetId = match[2];
    if (seen.has(assetId)) continue;
    seen.add(assetId);

    const previous = fallbackById.get(assetId) || {};
    const options = parseImageOptions(match[3]);
    references.push({
      ...previous,
      assetId,
      position: previous.position || "manual",
      anchor: previous.anchor || "",
      order: references.length,
      altText: normalizeString(match[1], previous.altText || "Content image").slice(0, 500),
      caption: normalizeString(options.caption, previous.caption || "").slice(0, 1000),
      approved: previous.approved !== false,
    });
  }

  return normalizeImages(references);
};

const imageIdsFrom = (images = []) =>
  [...new Set(images.map((image) => String(image.assetId)).filter(Boolean))];

const runInTransaction = async (operation) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

const updateImageReferences = async ({
  companyId,
  userId,
  addedIds,
  removedIds,
  session,
}) => {
  if (addedIds.length) {
    await ContentStudioImageAsset.updateMany(
      { _id: { $in: addedIds }, companyId, status: { $ne: "deleted" } },
      { $inc: { referenceCount: 1 } },
      { session },
    );
    await Promise.all(addedIds.map((imageId) =>
      recordImageAudit({
        companyId,
        userId,
        imageId,
        eventType: "image.attached",
        session,
      }),
    ));
  }

  if (removedIds.length) {
    await ContentStudioImageAsset.updateMany(
      { _id: { $in: removedIds }, companyId, referenceCount: { $gt: 0 } },
      { $inc: { referenceCount: -1 } },
      { session },
    );
    await Promise.all(removedIds.map((imageId) =>
      recordImageAudit({
        companyId,
        userId,
        imageId,
        eventType: "image.detached",
        session,
      }),
    ));
  }
};

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
  imagePlacementMode,
  images,
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
    imagePlacementMode: ["manual", "assisted", "automatic"].includes(imagePlacementMode)
      ? imagePlacementMode : "manual",
    images: extractImagesFromContent(normalizedContent, images),
  };
};

export const saveContent = async (input) => {
  const payload = buildContentPayload(input);
  const assetIds = imageIdsFrom(payload.images);

  return runInTransaction(async (session) => {
    await validateCompanyImages({
      companyId: payload.companyId,
      userId: payload.createdByUserId,
      assetIds,
      action: "attach",
      session,
    });

    const [created] = await ContentStudioContent.create([payload], { session });
    await updateImageReferences({
      companyId: payload.companyId,
      userId: payload.createdByUserId,
      addedIds: assetIds,
      removedIds: [],
      session,
    });
    return created;
  });
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

  if (["manual", "assisted", "automatic"].includes(updates.imagePlacementMode)) {
    allowedUpdates.imagePlacementMode = updates.imagePlacementMode;
  }

  if (updates.brief && typeof updates.brief === "object") {
    allowedUpdates.brief = normalizeBrief(updates.brief);
  }

  allowedUpdates.lastEditedByUserId = userId;

  return runInTransaction(async (session) => {
    const existing = await ContentStudioContent.findOne({
      _id: contentId,
      companyId,
    }).session(session);

    if (!existing) return null;

    if (typeof allowedUpdates.content === "string") {
      const fallbackImages = Array.isArray(updates.images)
        ? updates.images
        : existing.images;
      allowedUpdates.images = extractImagesFromContent(
        allowedUpdates.content,
        fallbackImages,
      );
    } else if (Array.isArray(updates.images)) {
      allowedUpdates.images = normalizeImages(updates.images);
    }

    const previousIds = imageIdsFrom(existing.images);
    const nextIds = Array.isArray(allowedUpdates.images)
      ? imageIdsFrom(allowedUpdates.images)
      : previousIds;

    if (Array.isArray(allowedUpdates.images)) {
      await validateCompanyImages({
        companyId,
        userId,
        assetIds: nextIds,
        action: "attach",
        session,
      });
    }

    const addedIds = nextIds.filter((id) => !previousIds.includes(id));
    const removedIds = previousIds.filter((id) => !nextIds.includes(id));

    const updated = await ContentStudioContent.findOneAndUpdate(
      { _id: contentId, companyId },
      { $set: allowedUpdates },
      { new: true, runValidators: true, session },
    );

    await updateImageReferences({
      companyId,
      userId,
      addedIds,
      removedIds,
      session,
    });

    return updated?.toObject();
  });
};

export const deleteContent = async ({
  companyId,
  contentId,
}) => {
  ensureObjectId(companyId, "company ID");
  ensureObjectId(contentId, "content ID");

  return runInTransaction(async (session) => {
    const deleted = await ContentStudioContent.findOneAndDelete({
      _id: contentId,
      companyId,
    }).session(session);

    if (!deleted) return null;

    await updateImageReferences({
      companyId,
      userId: deleted.lastEditedByUserId || deleted.createdByUserId,
      addedIds: [],
      removedIds: imageIdsFrom(deleted.images),
      session,
    });

    return deleted.toObject();
  });
};