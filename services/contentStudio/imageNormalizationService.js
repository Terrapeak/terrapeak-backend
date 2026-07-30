import path from "node:path";
import sharp from "sharp";

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_DIMENSION = 8_000;
const MAX_STORED_DIMENSION = 4_096;

const makeError = (message, code) => {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
};

const signatureType = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
};

export const normalizeContentStudioImage = async ({ buffer, filename = "image", declaredMimeType = "" }) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw makeError("The image file is empty.", "IMAGE_EMPTY");
  if (buffer.length > MAX_INPUT_BYTES) throw makeError("The image must be 5 MB or smaller.", "IMAGE_TOO_LARGE");

  const detectedMimeType = signatureType(buffer);
  if (!detectedMimeType) throw makeError("Only genuine JPEG, PNG, or WebP images are supported.", "IMAGE_SIGNATURE_INVALID");
  if (declaredMimeType && declaredMimeType !== detectedMimeType) {
    throw makeError("The image file type does not match its content.", "IMAGE_TYPE_MISMATCH");
  }

  let metadata;
  try {
    metadata = await sharp(buffer, {
      animated: false,
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "warning",
    }).metadata();
  } catch {
    throw makeError("The image is invalid or exceeds the safe decoding limit.", "IMAGE_DECODE_FAILED");
  }

  const width = Number(metadata.width) || 0;
  const height = Number(metadata.height) || 0;
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_INPUT_PIXELS) {
    throw makeError("The image dimensions exceed the allowed limit.", "IMAGE_DIMENSIONS_EXCEEDED");
  }
  if ((metadata.pages || 1) > 1) throw makeError("Animated images are not supported.", "ANIMATED_IMAGE_NOT_ALLOWED");

  const output = await sharp(buffer, { animated: false, limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({
      width: MAX_STORED_DIMENSION,
      height: MAX_STORED_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toColourspace("srgb")
    .webp({ quality: 85, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  if (output.data.length > MAX_OUTPUT_BYTES) {
    throw makeError("The normalized image is still too large.", "IMAGE_NORMALIZED_TOO_LARGE");
  }

  const safeBase = path.basename(filename, path.extname(filename)).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 180) || "image";
  return {
    buffer: output.data,
    filename: `${safeBase}.webp`,
    mimeType: "image/webp",
    width: output.info.width,
    height: output.info.height,
    bytes: output.info.size,
    originalMimeType: detectedMimeType,
  };
};

export const IMAGE_SAFETY_LIMITS = Object.freeze({
  maxInputBytes: MAX_INPUT_BYTES,
  maxInputPixels: MAX_INPUT_PIXELS,
  maxDimension: MAX_DIMENSION,
  maxStoredDimension: MAX_STORED_DIMENSION,
});
