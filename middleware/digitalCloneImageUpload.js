import multer from "multer";
import rateLimit from "express-rate-limit";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const fileFilter = (_req, file, callback) => {
  if (!allowedTypes.has(file.mimetype)) {
    const error = new Error("Only JPEG, PNG, and WebP reference images are supported.");
    error.statusCode = 400;
    return callback(error);
  }
  return callback(null, true);
};

export const digitalCloneImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter,
}).array("images", 10);

export const digitalCloneImageRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    success: false,
    code: "RATE_LIMITED",
    message: "Too many identity image uploads. Please wait before trying again.",
  }),
});
