export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_FALLBACK_TEXT_MODEL = "gemini-3.5-flash-lite";

export const GEMINI_TEXT_MODELS = [
  DEFAULT_GEMINI_TEXT_MODEL,
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  DEFAULT_GEMINI_FALLBACK_TEXT_MODEL,
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite",
];

export const GEMINI_TEXT_MODEL_SET = new Set(GEMINI_TEXT_MODELS);

export const LEGACY_GEMINI_TEXT_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
]);

export const normalizeGeminiTextModel = (model) =>
  GEMINI_TEXT_MODEL_SET.has(model) ? model : DEFAULT_GEMINI_TEXT_MODEL;

export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
export const LEGACY_GEMINI_IMAGE_MODELS = new Set([
  "imagen-4.0-generate-001",
  "imagen-4.0-fast-generate-001",
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-preview-image-generation",
]);

export const GEMINI_IMAGE_MODELS = [
  DEFAULT_GEMINI_IMAGE_MODEL,
  "gemini-3.1-flash-lite-image",
  "gemini-3-pro-image",
  ...LEGACY_GEMINI_IMAGE_MODELS,
];

export const GEMINI_IMAGE_MODEL_SET = new Set(GEMINI_IMAGE_MODELS);

export const normalizeGeminiImageModel = (model) =>
  LEGACY_GEMINI_IMAGE_MODELS.has(model) ? DEFAULT_GEMINI_IMAGE_MODEL : model;
