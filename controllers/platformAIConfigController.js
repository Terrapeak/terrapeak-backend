import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import ChatbotSettings from "../models/chatbotSettings.js";

const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
]);

const ACTIVITY_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 12000;

const maskKey = (value = "") => {
  const key = String(value || "");
  if (!key) return null;
  return `••••••••${key.slice(-4)}`;
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
              title: "AI configuration updated",
              appSlug: "ai-assistant",
              appName: "AI Assistant",
              actorUserId: actor?._id || null,
              actorName: actor?.name || "",
              actorEmail: actor?.email || "",
              createdAt: new Date(),
              metadata: {
                model,
                keyReplaced: Boolean(keyReplaced),
              },
            },
          ],
          $position: 0,
          $slice: ACTIVITY_LIMIT,
        },
      },
    }
  );
};

const getCompanyAndSettings = async (companyId) => {
  const company = await Company.findById(companyId).select("_id name displayName");
  if (!company) return { company: null, settings: [] };

  const settings = await ChatbotSettings.find({ companyId: company._id })
    .select("_id botName geminiKey gemini_model updatedAt")
    .sort({ createdAt: 1 });

  return { company, settings };
};

const buildSafeConfig = (settings = []) => {
  const primary = settings[0] || null;
  const configuredSettings = settings.filter((item) => Boolean(item.geminiKey));
  const model = primary?.gemini_model || "gemini-2.5-flash";

  return {
    provider: "Gemini",
    configured: configuredSettings.length > 0,
    configuredChatbots: configuredSettings.length,
    totalChatbots: settings.length,
    maskedKey: maskKey(primary?.geminiKey),
    model,
    updatedAt: primary?.updatedAt || null,
    allowedModels: Array.from(ALLOWED_MODELS),
  };
};

export const getPlatformAIConfig = asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  const { company, settings } = await getCompanyAndSettings(companyId);

  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  res.json({ success: true, aiConfig: buildSafeConfig(settings) });
});

export const updatePlatformAIConfig = asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  const { geminiKey, model } = req.body;
  const { company, settings } = await getCompanyAndSettings(companyId);

  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  if (!settings.length) {
    return res.status(409).json({
      success: false,
      message: "No chatbot settings exist for this company yet.",
    });
  }

  const nextModel = model || settings[0]?.gemini_model || "gemini-2.5-flash";
  if (!ALLOWED_MODELS.has(nextModel)) {
    return res.status(400).json({ success: false, message: "Unsupported Gemini model." });
  }

  const replacementKey = String(geminiKey || "").trim();
  const updates = { gemini_model: nextModel };
  if (replacementKey) updates.geminiKey = replacementKey;

  await ChatbotSettings.updateMany({ companyId: company._id }, { $set: updates });

  await appendActivity({
    companyId: company._id,
    actor: req.platformUser,
    model: nextModel,
    keyReplaced: Boolean(replacementKey),
  });

  const refreshed = await ChatbotSettings.find({ companyId: company._id })
    .select("_id botName geminiKey gemini_model updatedAt")
    .sort({ createdAt: 1 });

  res.json({ success: true, aiConfig: buildSafeConfig(refreshed) });
});

export const testPlatformAIConfig = asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  const { company, settings } = await getCompanyAndSettings(companyId);

  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  const primary = settings.find((item) => item.geminiKey) || settings[0];
  if (!primary?.geminiKey) {
    return res.status(409).json({ success: false, message: "Gemini API key is not configured." });
  }

  const model = primary.gemini_model || "gemini-2.5-flash";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(primary.geminiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply with OK." }] }],
          generationConfig: { maxOutputTokens: 8 },
        }),
        signal: controller.signal,
      }
    );

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(400).json({
        success: false,
        message:
          payload?.error?.message ||
          `Gemini rejected the configuration with status ${response.status}.`,
      });
    }

    res.json({ success: true, message: "Gemini connection successful.", model });
  } catch (error) {
    if (error?.name === "AbortError") {
      return res.status(504).json({ success: false, message: "Gemini connection test timed out." });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
});
