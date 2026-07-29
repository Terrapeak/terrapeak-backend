import mongoose from "mongoose";
import ContentStudioBrandSettings from "../../models/contentStudioBrandSettings.js";

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

const normalizeStringList = (
  value,
  maximumItems = 100,
  maximumItemLength = 500,
) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeString(item).slice(0, maximumItemLength))
      .filter(Boolean)
      .slice(0, maximumItems);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim().slice(0, maximumItemLength))
      .filter(Boolean)
      .slice(0, maximumItems);
  }

  return [];
};

const normalizeSettings = (settings = {}) => ({
  brandName: normalizeString(settings.brandName),
  websiteUrl: normalizeString(settings.websiteUrl),
  brandDescription: normalizeString(settings.brandDescription),
  targetAudience: normalizeString(settings.targetAudience),

  defaultTone:
    normalizeString(settings.defaultTone, "professional").toLowerCase() ||
    "professional",

  voiceTraits: normalizeStringList(settings.voiceTraits),
  productsAndServices: normalizeStringList(
    settings.productsAndServices,
  ),
  preferredKeywords: normalizeStringList(
    settings.preferredKeywords,
  ),
  bannedWords: normalizeStringList(settings.bannedWords),
  writingRules: normalizeStringList(settings.writingRules),

  defaultCallToAction: normalizeString(
    settings.defaultCallToAction,
  ),

  additionalContext: normalizeString(settings.additionalContext),
});

export const getBrandSettings = async ({ companyId }) => {
  ensureObjectId(companyId, "company ID");

  const settings = await ContentStudioBrandSettings.findOne({
    companyId,
  }).lean();

  if (settings) {
    return settings;
  }

  return {
    companyId,
    brandName: "",
    websiteUrl: "",
    brandDescription: "",
    targetAudience: "",
    defaultTone: "professional",
    voiceTraits: [],
    productsAndServices: [],
    preferredKeywords: [],
    bannedWords: [],
    writingRules: [],
    defaultCallToAction: "",
    additionalContext: "",
  };
};

export const saveBrandSettings = async ({
  companyId,
  userId,
  settings,
}) => {
  ensureObjectId(companyId, "company ID");
  ensureObjectId(userId, "user ID");

  const normalizedSettings = normalizeSettings(settings);

  return ContentStudioBrandSettings.findOneAndUpdate(
    {
      companyId,
    },
    {
      $set: {
        ...normalizedSettings,
        companyId,
        updatedByUserId: userId,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  ).lean();
};