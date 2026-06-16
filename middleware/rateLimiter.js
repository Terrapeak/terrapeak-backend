// middleware/rateLimiter.js
import rateLimit from "express-rate-limit";

export const askRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Max 10 requests per IP per minute
  message: { success: false, error: "Too many requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
