import asyncHandler from "express-async-handler";

import Company from "../models/company.js";

const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
]);

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
    configured: Boolean(config.geminiKey),
    maskedKey: maskKey(config.geminiKey),
    model: config.model || "gemini-2.5-flash",
    fallbackModel: config.fallbackModel || "gemini-2.5-flash-lite",
    updatedAt: config.updatedAt || null,
    allowedModels: Array.from(ALLOWED_MODELS),
  };
};

const appendActivity = async ({ companyId, actor, model, keyReplaced }) => {
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
              metadata: { model, keyReplaced: Boolean(keyReplaced) },
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

  if (!ALLOWED_MODELS.has(nextModel) || !ALLOWED_MODELS.has(nextFallbackModel)) {
    return res.status(400).json({ success: false, message: "Unsupported Gemini model." });
  }

  const replacementKey = String(req.body?.geminiKey || "").trim();
  company.contentStudioAiConfig = {
    provider: "Gemini",
    geminiKey: replacementKey || current.geminiKey || "",
    model: nextModel,
    fallbackModel: nextFallbackModel,
    updatedAt: new Date(),
  };

  await company.save();
  await appendActivity({
    companyId: company._id,
    actor: req.platformUser,
    model: nextModel,
    keyReplaced: Boolean(replacementKey),
  });

  return res.json({ success: true, aiConfig: buildSafeConfig(company) });
});

export const testPlatformContentStudioAIConfig = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.companyId).select(
    "_id contentStudioAiConfig",
  );

  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  const config = company.contentStudioAiConfig || {};
  if (!config.geminiKey) {
    return res.status(409).json({
      success: false,
      message: "Content Studio Gemini API key is not configured.",
    });
  }

  const model = config.model || "gemini-2.5-flash";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.geminiKey)}`,
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
      return res.status(400).json({
        success: false,
        message:
          payload?.error?.message ||
          `Gemini rejected the Content Studio configuration with status ${response.status}.`,
      });
    }

    return res.json({
      success: true,
      message: "Content Studio Gemini connection successful.",
      model,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return res.status(504).json({
        success: false,
        message: "Content Studio Gemini connection test timed out.",
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
});
