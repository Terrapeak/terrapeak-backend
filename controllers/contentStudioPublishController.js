import {
  getPublishedContent,
  publishContent,
} from "../services/contentStudio/publishContentService.js";
import {
  commitContentStudioUsage,
  createUsageRequestId,
  reserveContentStudioUsage,
  rollbackContentStudioUsage,
} from "../services/contentStudio/contentStudioUsageService.js";
import ContentStudioContent from "../models/contentStudioContent.js";
import ContentStudioImageAsset from "../models/contentStudioImageAsset.js";

const companyIdFor = (req) => req.company?._id || req.companyId;
const userIdFor = (req) => req.user?._id || req.user?.id || req.userId;

export const publishContentController = async (req, res) => {
  const companyId = companyIdFor(req);
  const userId = userIdFor(req);
  const existing = await ContentStudioContent.findOne({
    _id: req.params.id,
    companyId,
  }).lean();
  if (!existing) {
    return res.status(404).json({ success: false, message: "Content was not found." });
  }
  const ids = [...new Set((existing.images || []).map((image) => String(image.assetId)))];
  const unpublished = ids.length
    ? await ContentStudioImageAsset.find({
        _id: { $in: ids },
        companyId,
        status: "active",
        $or: [{ publishedUrl: "" }, { publishedUrl: { $exists: false } }],
      }).select("bytes").lean()
    : [];
  const reservedBytes = unpublished.reduce(
    (total, asset) => total + Math.max(0, Number(asset.bytes) || 0),
    0,
  );
  const requestId = String(
    req.get("Idempotency-Key") || req.body?.requestId || createUsageRequestId(),
  ).slice(0, 200);
  await reserveContentStudioUsage({
    companyId,
    requestId,
    action: "publish",
    storageBytes: reservedBytes,
    imageCount: 0,
    generationCount: 0,
    metadata: { userId, contentId: String(existing._id) },
  });
  try {
    const result = await publishContent({
      companyId,
      userId,
      contentId: req.params.id,
    });
    await commitContentStudioUsage({
      companyId,
      requestId,
      action: "publish",
      actualStorageBytes: result.publishedStorageBytes,
    });
    return res.status(200).json({ success: true, data: result.content });
  } catch (error) {
    await rollbackContentStudioUsage({
      companyId,
      requestId,
      action: "publish",
      failureCode: error?.code || "CONTENT_PUBLISH_FAILED",
    });
    throw error;
  }
};

export const downloadPublishedContentController = async (req, res) => {
  const result = await getPublishedContent({
    companyId: companyIdFor(req),
    contentId: req.params.id,
  });
  if (!result) {
    return res.status(404).json({
      success: false,
      message: "Published content was not found.",
    });
  }
  const safeName = String(result.title || "published-content")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "published-content";
  res.set({
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safeName}.md"`,
    "Cache-Control": "private, no-store",
  });
  return res.status(200).send(result.publishedContent);
};
