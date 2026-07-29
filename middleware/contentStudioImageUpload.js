import multer from "multer";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const fileFilter = (_req, file, callback) => {
  if (!allowedTypes.has(file.mimetype)) {
    const error = new Error("Only JPEG, PNG, and WebP images are supported.");
    error.statusCode = 400;
    return callback(error);
  }
  return callback(null, true);
};

export const contentStudioImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 6 },
  fileFilter,
}).array("images", 6);
