import fs from "fs";
import path from "path";
import multer from "multer";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const ALLOWED_UPLOAD_TYPES = new Map([
  [".txt", "text/plain"],
  [".pdf", "application/pdf"],
  [
    ".docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
]);

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(req, file, callback) {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const expectedMimeType = ALLOWED_UPLOAD_TYPES.get(extension);

    if (!expectedMimeType || file.mimetype !== expectedMimeType) {
      const error = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname);
      error.message = "Unsupported file type. Use PDF, TXT, or DOCX.";
      return callback(error);
    }

    return callback(null, true);
  },
});

export const removeFile = (filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

export default upload;
