import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import {
  encryptContentStudioCredential,
  resolveCompanyContentStudioKeys,
} from "../utils/contentStudioCredentialEncryption.js";

const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
]);

const CURRENT_IMAGE_MODEL = "gemini-2.5-flash-image";
const LEGACY_IMAGE_MODELS = new Set([
  "imagen-4.0-generate-001",
  "imagen-4.0-fast-generate-001",
  "gemini-2.0-flash-preview-image-generation",
]);
const ALLOWED_IMAGE_MODELS = new Set([
  CURRENT_IMAGE_MODEL,
  ...LEGACY_IMAGE_MODELS,
]);
const normalizeImageModel = (model) =>
  LEGACY_IMAGE_MODELS.has(model) ? CURRENT_IMAGE_MODEL : model;

const REQUEST_TIMEOUT_MS = 12000;
const ACTIVITY_LIMIT = 50;

const maskKey = (value = "") => {
  const key = String(value || "");
  return key ? `••••••••${key.slice(-4)}` : null;
};

const buildSafeConfig = (company) => {
  const config = company?.contentStudioAiConfig || {};
  return {
    provider: config.provider || "Gemini",
    configured: Boolean(config.geminiKeyEncrypted?.ciphertext || config.geminiKey),
    maskedKey: config.geminiKeyEncrypted?.lastFour
      ? `••••••••${config.geminiKeyEncrypted.lastFour}`
      : maskKey(config.geminiKey),
    model: config.model || "gemini-2.5-flash",
    fallbackModel: config.fallbackModel || "gemini-2.5-flash-lite",
    imageConfigured: Boolean(config.imageGeminiKeyEncrypted?.ciphertext || config.imageGeminiKey),
    maskedImageKey: config.imageGeminiKeyEncrypted?.lastFour
      ? `••••••••${config.imageGeminiKeyEncrypted.lastFour}`
      : maskKey(config.imageGeminiKey),
    imageModel: normalizeImageModel(config.imageModel || CURRENT_IMAGE_MODEL),
    updatedAt: config.updatedAt || null,
    allowedModels: Array.from(ALLOWED_MODELS),
    allowedImageModels: Array.from(ALLOWED_IMAGE_MODELS),
  };
};

const appendActivity = async ({
  companyId,
  actor,
  model,
  imageModel,
  keyReplaced,
  imageKeyReplaced,
}) => {
  await Company.updateOne(
    { _id: companyId },
    {
      $push: {
        activityEvents: {
          $each: [
            {
              eventType: "updated",
              title: "Content Studio AI configuration updated",
              appSlug: "content-studio",
              appName: "Content Studio",
              actorUserId: actor?._id || null,
              actorName: actor?.name || "",
              actorEmail: actor?.email || "",
              createdAt: new Date(),
              metadata: {
                model,
                imageModel,
                keyReplaced: Boolean(keyReplaced),
                imageKeyReplaced: Boolean(imageKeyReplaced),
              },
            },
          ],
          $position: 0,
          $slice: ACTIVITY_LIMIT,
        },
      },
    },
  );
};

export const getPlatformContentStudioAIConfig = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.companyId).select(
    "_id contentStudioAiConfig",
  );

  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  return res.json({ success: true, aiConfig: buildSafeConfig(company) });
});

export const updatePlatformContentStudioAIConfig = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.companyId);

  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  const current = company.contentStudioAiConfig || {};
  const nextModel = req.body?.model || current.model || "gemini-2.5-flash";
  const nextFallbackModel =
    req.body?.fallbackModel || current.fallbackModel || "gemini-2.5-flash-lite";
  const nextImageModel =
    normalizeImageModel(
      req.body?.imageModel || current.imageModel || CURRENT_IMAGE_MODEL,
    );

  if (!ALLOWED_MODELS.has(nextModel) || !ALLOWED_MODELS.has(nextFallbackModel)) {
    return res.status(400).json({ success: false, message: "Unsupported Gemini text model." });
  }

  if (!ALLOWED_IMAGE_MODELS.has(nextImageModel)) {
    return res.status(400).json({ success: false, message: "Unsupported Gemini image model." });
  }

  const replacementKey = String(req.body?.geminiKey || "").trim();
  const replacementImageKey = String(req.body?.imageGeminiKey || "").trim();

  const currentObject = current.toObject?.() || { ...current };
  company.contentStudioAiConfig = {
    ...currentObject,
    provider: "Gemini",
    model: nextModel,
    fallbackModel: nextFallbackModel,
    imageModel: nextImageModel,
    updatedAt: new Date(),
    ...(replacementKey
      ? { geminiKeyEncrypted: encryptContentStudioCredential(replacementKey) }
      : {}),
    ...(replacementImageKey
      ? { imageGeminiKeyEncrypted: encryptContentStudioCredential(replacementImageKey) }
      : {}),
  };

  await company.save();
  await appendActivity({
    companyId: company._id,
    actor: req.platformUser,
    model: nextModel,
    imageModel: nextImageModel,
    keyReplaced: Boolean(replacementKey),
    imageKeyReplaced: Boolean(replacementImageKey),
  });

  return res.json({ success: true, aiConfig: buildSafeConfig(company) });
});

const testModelAccess = async ({ key, model, image = false }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = image
      ? await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(key)}`,
          { signal: controller.signal },
        )
      : await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: "Reply with OK." }] }],
              generationConfig: { maxOutputTokens: 8 },
            }),
            signal: controller.signal,
          },
        );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        payload?.error?.message ||
          `Gemini rejected the ${image ? "image" : "text"} configuration with status ${response.status}.`,
      );
      error.statusCode = 400;
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
};

export const testPlatformContentStudioAIConfig = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.companyId).select(
    "_id contentStudioAiConfig",
  );

  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  const config = company.contentStudioAiConfig || {};
  const { textKey, imageKey } = resolveCompanyContentStudioKeys(company);
  if (!textKey || !imageKey) {
    return res.status(409).json({
      success: false,
      message: "Configure both Content Studio text and image Gemini API keys before testing.",
    });
  }

  const model = config.model || "gemini-2.5-flash";
  const imageModel = normalizeImageModel(
    config.imageModel || CURRENT_IMAGE_MODEL,
  );

  try {
    await testModelAccess({ key: textKey, model });
    await testModelAccess({ key: imageKey, model: imageModel, image: true });
  } catch (error) {
    if (error?.name === "AbortError") {
      return res.status(504).json({
        success: false,
        message: "Content Studio Gemini connection test timed out.",
      });
    }
    throw error;
  }

  return res.json({
    success: true,
    message: "Content Studio text and image Gemini connections are configured.",
    model,
    imageModel,
  });
});
