const ALLOWED_CHATBOT_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
]);

const validateChatbotModel = (req, res, next) => {
  const requestedModel = req.body?.gemini_model;

  if (requestedModel === undefined) {
    return next();
  }

  if (!ALLOWED_CHATBOT_MODELS.has(requestedModel)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CHATBOT_MODEL",
      message: "The selected chatbot model is not supported.",
    });
  }

  return next();
};

export default validateChatbotModel;
