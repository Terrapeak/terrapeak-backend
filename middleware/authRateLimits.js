import rateLimit from "express-rate-limit";

const buildLimiter = ({ windowMs, limit, message, skipSuccessfulRequests = false }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: (_req, res) =>
      res.status(429).json({
        success: false,
        code: "RATE_LIMITED",
        message,
      }),
  });

export const loginRateLimit = buildLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: "Too many failed sign-in attempts. Please wait 15 minutes and try again.",
});

export const platformLoginRateLimit = buildLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  message: "Too many failed platform sign-in attempts. Please wait 15 minutes and try again.",
});

export const signupOtpRateLimit = buildLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: "Too many verification-code requests. Please wait before requesting another code.",
});

export const accountTokenRateLimit = buildLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Too many account setup attempts. Please wait 15 minutes and try again.",
});
