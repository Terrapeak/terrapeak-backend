import rateLimit from "express-rate-limit";

const keyGenerator = (req) => `${String(req.company?._id || "no-company")}:${String(req.userId || "no-user")}`;
const handler = (message) => (_req, res) => res.status(429).json({
  success: false,
  code: "DIGITAL_CLONE_VOICE_RATE_LIMITED",
  message,
});

const positiveLimit = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const DIGITAL_CLONE_VOICE_RATE_LIMITS = Object.freeze({
  uploadPer15Minutes: positiveLimit(process.env.DIGITAL_CLONE_VOICE_UPLOAD_LIMIT, 10),
  createPerHour: positiveLimit(process.env.DIGITAL_CLONE_VOICE_CREATE_LIMIT, 3),
  previewPer15Minutes: positiveLimit(process.env.DIGITAL_CLONE_VOICE_PREVIEW_LIMIT, 10),
  concurrentUploadsPerInstance: positiveLimit(process.env.DIGITAL_CLONE_VOICE_UPLOAD_CONCURRENCY, 2),
});

const activeUploadKeys = new Set();
let activeUploads = 0;

export const digitalCloneVoiceUploadConcurrencyLimit = (req, res, next) => {
  const key = keyGenerator(req);
  if (activeUploadKeys.has(key) || activeUploads >= DIGITAL_CLONE_VOICE_RATE_LIMITS.concurrentUploadsPerInstance) {
    return res.status(429).json({
      success: false,
      code: "DIGITAL_CLONE_VOICE_UPLOAD_BUSY",
      message: "Another voice upload is already being processed. Please try again shortly.",
    });
  }
  activeUploadKeys.add(key);
  activeUploads += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeUploadKeys.delete(key);
    activeUploads = Math.max(0, activeUploads - 1);
  };
  res.once("finish", release);
  res.once("close", release);
  return next();
};

export const digitalCloneVoiceUploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: DIGITAL_CLONE_VOICE_RATE_LIMITS.uploadPer15Minutes,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator,
  handler: handler("Too many voice sample uploads. Please wait before trying again."),
});

export const digitalCloneVoiceCreationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: DIGITAL_CLONE_VOICE_RATE_LIMITS.createPerHour,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator,
  handler: handler("Too many voice creation attempts. Please wait before trying again."),
});

export const digitalCloneVoicePreviewRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: DIGITAL_CLONE_VOICE_RATE_LIMITS.previewPer15Minutes,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator,
  handler: handler("Too many voice preview requests. Please wait before trying again."),
});
