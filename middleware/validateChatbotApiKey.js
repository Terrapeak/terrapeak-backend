import ChatbotSettings from "../models/chatbotSettings.js";

// export const validateChatbotDomain = async (req, res, next) => {
//   try {
//     const apiKey = req.headers["x-api-key"];

//     if (!apiKey) {
//       return next(new CustomError("API Key is missing", 401));
//     }

//     // Find chatbot settings linked to this apiKey
//     const chatbot = await ChatbotSettings.findOne({ apiKey });

//     if (!chatbot) {
//       throw error("Invalid API Key");
//     }

//     // Attach chatbot to request
//     req.chatbot = chatbot;

//     next();
//   } catch (error) {
//     next(error);
//   }
// };

export const verifyDomain = async (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(401).json({ error: " API key missing" });
  }
  const settings = await ChatbotSettings.findOne({ apiKey });
  console.log(apiKey);
  if (!settings) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  const parentDomain = req.headers["x-parent-domain"];

  if (!parentDomain) {
    return res.status(403).json({ error: "Missing parent domain" });
  }
  console.log(parentDomain);
  const allowed = settings.allowedDomains.some((domain) =>
    parentDomain.includes(domain)
  );

  if (!allowed) {
    return res.status(403).json({
      error: "Domain not allowed",
      parentDomain,
    });
  }
  req.chatbot = settings;
  next();
};
