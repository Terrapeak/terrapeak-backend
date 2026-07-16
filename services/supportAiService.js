const SUPPORT_MODEL = process.env.SUPPORT_AI_MODEL || "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 12000;

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    const match = String(value || "").match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
};

const createSupportAiError = (code, message, status = 503) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const getSupportApiKey = () =>
  process.env.SUPPORT_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

const mapGeminiError = (status, payload) => {
  const rawMessage = String(payload?.error?.message || "").toLowerCase();

  if (status === 400 && rawMessage.includes("api key")) {
    return createSupportAiError(
      "INVALID_API_KEY",
      "Gemini rejected the support API key. Check SUPPORT_GEMINI_API_KEY in Railway.",
      400
    );
  }
  if (status === 401 || status === 403) {
    return createSupportAiError(
      "PERMISSION_DENIED",
      "Gemini denied access