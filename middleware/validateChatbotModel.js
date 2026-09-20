import { GEMINI_TEXT_MODEL_SET } from "../config/geminiModels.js";

const validateChatbotModel = (req, res, next) => {
  const requestedModel = req.body?.gemini_model;

  if (requestedModel === undefined) {
    return next();
  }

  if (!GEMINI_TEXT_MODEL_SET.has(requestedModel)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CHATBOT_MODEL",
      message: "The selected chatbot model is not supported.",
    });
  }

  return next();
};

export default validateChatbotModel;
