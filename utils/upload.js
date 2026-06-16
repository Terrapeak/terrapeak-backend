// utils/upload.js

import multer from "multer";
import fs from "fs";

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }, // 2MB
});

export const removeFile = (path) => {
  if (fs.existsSync(path)) {
    fs.unlinkSync(path);
  }
};

export default upload;
