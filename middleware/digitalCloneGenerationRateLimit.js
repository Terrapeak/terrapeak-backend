import rateLimit from "express-rate-limit";

export const digitalCloneGenerationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${String(req.company?._id || "no-company")}:${String(req.userId || "no-user")}`,
  handler: (req, res) => res.status(429).json({
    success: false,
    code: "DIGITAL_CLONE_GENERATION_RATE_LIMITED",
    message: "Too many generation requests. Please try again later.",
  }),
});
