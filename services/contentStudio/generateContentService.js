import { randomUUID } from "crypto";
import { generateWithGemini } from "./geminiClient.js";
import { buildContentPrompt } from "./promptBuilder.js";
import { getBrandSettings } from "./brandSettingsService.js";

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    const match = String(value || "").match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const cleanText = (value, maximumLength) =>
  String(value || "").trim().slice(0, maximumLength);

const normalizeGeneratedContent = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const suggestedKeywords = Array.isArray(value.suggestedKeywords)
    ? value.suggestedKeywords
        .map((keyword) => cleanText(keyword, 100))
        .filter(Boolean)
        .slice(0, 20)
    : [];

  const normalized = {
    title: cleanText(value.title, 300),
    summary: cleanText(value.summary, 1000),
    content: cleanText(value.content, 50000),
    seoTitle: cleanText(value.seoTitle, 300),
    seoDescription: cleanText(value.seoDescription, 500),
    suggestedKeywords,
    socialCaption: cleanText(value.socialCaption, 2000),
  };

  if (!normalized.title || !normalized.content) {
    return null;
  }

  return normalized;
};

export const generateContent = async ({
  company,
  userId,
  brief,
}) => {
  const brandSettings = company?._id
    ? await getBrandSettings({
      companyId: company._id,
    })
  : {};

  const prompt = buildContentPrompt({
  brief: {
    ...brief,
    companyName: company?.name,
  },
  brandSettings,
});

  const aiResult = await generateWithGemini({
    systemInstruction,
    prompt,
    temperature: 0.65,
    maxOutputTokens:
      brief.length === "long"
        ? 8192
        : brief.length === "short"
          ? 3072
          : 5120,
  });

  const parsed = safeJsonParse(aiResult.text);
  const generatedContent = normalizeGeneratedContent(parsed);

  if (!generatedContent) {
    const error = new Error(
      "The generated content could not be processed. Please try again."
    );

    error.code = "INVALID_GENERATED_CONTENT";
    error.statusCode = 502;

    throw error;
  }

  return {
    id: randomUUID(),
    companyId: company._id,
    createdBy: userId,
    brief,
    result: generatedContent,
    model: aiResult.model,
    usage: aiResult.usage,
    createdAt: new Date(),
  };
};