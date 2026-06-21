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
  const parentDomain = req.headers["x-parent-domain"];

  console.log("VERIFY DOMAIN RUNNING");
  console.log("apiKey:", apiKey);
  console.log("parentDomain:", parentDomain);

  if (!apiKey) {
    return res.status(401).json({ error: "API key missing" });
  }

  const settings = await ChatbotSettings.findOne({ apiKey });

  if (!settings) {
    console.log("API key not found in MongoDB");
    return res.status(403).json({ error: "Invalid API key" });
  }

  console.log("Settings found:", settings._id.toString());

  if (parentDomain && parentDomain.includes("localhost")) {
    console.log("Localhost allowed");
    req.chatbot = settings;
    return next();
  }

  if (!parentDomain) {
    return res.status(403).json({ error: "Missing parent domain" });
  }

  const allowed = settings.allowedDomains.some((domain) =>
    parentDomain.includes(domain)
  );

  if (!allowed) {
    console.log("Domain rejected:", parentDomain);
    return res.status(403).json({
      error: "Domain not allowed",
      parentDomain,
    });
  }

  req.chatbot = settings;
  next();
};
