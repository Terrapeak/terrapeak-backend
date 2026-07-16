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
  process