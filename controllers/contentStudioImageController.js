import asyncHandler from "express-async-handler";
import {
  deleteImageAsset,
  generateImagenAssets,
  importGoogleDriveImage,
  importImageUrl,
  listGoogleDriveImages,
  listImageAssets,
  uploadLocalImages,
} from "../services/contentStudio/imageAssetService.js";
import {
  commitContentStudioUsage,
  createUsageRequestId,
  reserveContentStudioUsage,
  rollbackContentStudioUsage,
} from "../services/contentStudio/contentStudioUsageService.js";
import {
  createImageDeliveryUrl,
  serializeImageAssetForClient,
} from "../services/contentStudio/imageDeliveryService.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const context = (req) => ({
  companyId: req.company?._id || req.companyId,
  userId: req.userId,
});

const requestIdFor = (req) =>
  String(req.get("Idempotency-Key") || req.body?.requestId || createUsageRequestId()).slice(0, 200);

const withUsageReservation = async ({ req, action, storageBytes, imageCount, generationCount = 0, work }) => {
  const { companyId } = context(req);
  const requestId = requestIdFor(req);
  await reserveContentStudioUsage({
    companyId, requestId, action, storageBytes, imageCount, generationCount,
    metadata: { userId: req.userId },
  });
  try {
    const result = await work();
    const assets = Array.isArray(result) ? result : [result];
    const actualStorageBytes = assets.reduce((total, asset) => total + Math.max(0, Number(asset?.bytes) || 0), 0);
    await commitContentStudioUsage({ companyId, requestId, action, actualStorageBytes });
    return result;
  } catch (error) {
    await rollbackContentStudioUsage({
      companyId, requestId, action,
      failureCode: error?.code || error?.response?.status || "IMAGE_ACTION_FAILED",
    });
    throw error;
  }
};

export const uploadImagesController = asyncHandler(async (req, res) => {
  const files = req.files || [];
  const assets = await withUsageReservation({
    req, action: "upload",
    storageBytes: files.reduce((total, file) => total + Math.max(0, Number(file.size) || file.buffer?.length || 0), 0),
    imageCount: files.length,
    work: () => uploadLocalImages({ ...context(req), files }),
  });
  res.status(201).json({ success: true, data: assets.map((asset) => serializeImageAssetForClient({ req, asset })) });
});

export const importImageUrlController = asyncHandler(async (req, res) => {
  const asset = await withUsageReservation({
    req, action: "import-url", storageBytes: MAX_IMAGE_BYTES, imageCount: 1,
    work: () => importImageUrl({ ...context(req), imageUrl: req.body?.url }),
  });
  res.status(201).json({ success: true, data: serializeImageAssetForClient({ req, asset }) });
});

export const listDriveImagesController = asyncHandler(async (req, res) => {
  const data = await listGoogleDriveImages({ userId: req.userId, pageToken: req.query.pageToken });
  res.json({ success: true, data });
});

export const importDriveImageController = asyncHandler(async (req, res) => {
  const asset = await withUsageReservation({
    req, action: "import-drive", storageBytes: MAX_IMAGE_BYTES, imageCount: 1,
    work: () => importGoogleDriveImage({ ...context(req), fileId: req.body?.fileId }),
  });
  res.status(201).json({ success: true, data: serializeImageAssetForClient({ req, asset }) });
});

export const generateImagesController = asyncHandler(async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) {
    const error = new Error("Describe the image you want to generate.");
    error.statusCode = 400;
    throw error;
  }
  const count = Math.min(Math.max(Number(req.body?.count) || 1, 1), 4);
  const assets = await withUsageReservation({
    req, action: "generate", storageBytes: MAX_IMAGE_BYTES * count,
    imageCount: count, generationCount: count,
    work: () => generateImagenAssets({
      ...context(req), prompt, count, aspectRatio: req.body?.aspectRatio,
    }),
  });
  res.status(201).json({ success: true, data: assets.map((asset) => serializeImageAssetForClient({ req, asset })) });
});

export const listImagesController = asyncHandler(async (req, res) => {
  const assetIds = String(req.query.assetIds || "").split(",").map((value) => value.trim()).filter((value) => /^[a-f0-9]{24}$/i.test(value)).slice(0, 100);
  const assets = await listImageAssets({ companyId: context(req).companyId, source: req.query.source, assetIds });
  res.json({ success: true, data: assets.map((asset) => serializeImageAssetForClient({ req, asset })) });
});

export const deleteImageController = asyncHandler(async (req, res) => {
  const asset = await deleteImageAsset({ ...context(req), assetId: req.params.assetId });
  res.json({ success: true, data: asset });
});

export const deliverImageController = asyncHandler(async (req, res) => {
  const { companyId, userId } = context(req);
  const url = await createImageDeliveryUrl({
    companyId,
    userId,
    assetId: req.params.assetId,
  });
  res.set("Cache-Control", "private, no-store");
  res.redirect(302, url);
});
