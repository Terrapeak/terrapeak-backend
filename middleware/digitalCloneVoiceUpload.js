import multer from "multer";

export const DIGITAL_CLONE_VOICE_UPLOAD_LIMITS = Object.freeze({
  maxFilesPerRequest: 3,
  maxFileBytes: 25 * 1024 * 1024,
  maxActiveSamples: 10,
});

const allowedMimeTypes = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
]);

const fileFilter = (_req, file, callback) => {
  if (!allowedMimeTypes.has(String(file.mimetype || "").toLowerCase())) {
    const error = new Error("Only WAV, MP3, M4A, and WebM voice recordings are supported.");
    error.statusCode = 400;
    error.code = "VOICE_SAMPLE_TYPE_INVALID";
    return callback(error);
  }
  return callback(null, true);
};

export const digitalCloneVoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: DIGITAL_CLONE_VOICE_UPLOAD_LIMITS.maxFileBytes,
    files: DIGITAL_CLONE_VOICE_UPLOAD_LIMITS.maxFilesPerRequest,
    fields: 5,
    parts: DIGITAL_CLONE_VOICE_UPLOAD_LIMITS.maxFilesPerRequest + 5,
  },
  fileFilter,
}).array("recordings", DIGITAL_CLONE_VOICE_UPLOAD_LIMITS.maxFilesPerRequest);
