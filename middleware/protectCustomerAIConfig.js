const maskGeminiKey = (value = "") => {
  const key = String(value || "");
  if (!key) return "";
  return `••••••••${key.slice(-4)}`;
};

export const stripCustomerAIConfigUpdates = (req, _res, next) => {
  if (req.body && typeof req.body === "object") {
    delete req.body.geminiKey;
    delete req.body.gemini_model;
  }

  next();
};

export const maskCustomerAIConfigResponse = (_req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (payload) => {
    if (payload