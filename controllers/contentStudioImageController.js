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

const context = (req) => ({
  companyId: req.company?._id || req.companyId,
  userId: req.userId,
});

export const uploadImagesController = asyncHandler(async (req, res) => {
  const assets = await uploadLocalImages({ ...context(req), files: req.files });
  res.status(201).json({ success: true, data: assets });
});

export const importImageUrlController = asyncHandler(async (req, res) => {
  const asset = await importImageUrl({ ...context(req), imageUrl: req.body?.url });
  res.status(201).json({ success: true, data: asset });
});

export const listDriveImagesController = asyncHandler(async (req, res) => {
  const data = await listGoogleDriveImages({ userId: req.userId, pageToken: req.query.pageToken });
  res.json({ success: true, data });
});

export const importDriveImageController = asyncHandler(async (req, res) => {
  const asset = await importGoogleDriveImage({ ...context(req), fileId: req.body?.fileId });
  res.status(201).json({ success: true, data: asset });
});

export const generateImagesController = asyncHandler(async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) {
    const error = new Error("Describe the image you want to generate.");
    error.statusCode = 400;
    throw error;
  }
  const assets = await generateImagenAssets({
    ...context(req),
    prompt,
    aspectRatio: req.body?.aspectRatio,
    count: req.body?.count,
  });
  res.status(201).json({ success: true, data: assets });
});

export const listImagesController = asyncHandler(async (req, res) => {
  const assets = await listImageAssets({ companyId: context(req).companyId, source: req.query.source });
  res.json({ success: true, data: assets });
});

export const deleteImageController = asyncHandler(async (req, res) => {
  const asset = await deleteImageAsset({ companyId: context(req).companyId, assetId: req.params.assetId });
  if (!asset) {
    const error = new Error("Image asset not found.");
    error.statusCode = 404;
    throw error;
  }
  res.json({ success: true, data: asset });
});
