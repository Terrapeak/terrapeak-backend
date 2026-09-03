import axios from "axios";
import { Readable } from "node:stream";
import { v2 as cloudinary } from "cloudinary";

const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_VOICE_PREVIEW_BYTES = 5 * 1024 * 1024;
const storageError = (code, message, statusCode = 502) => { const error = new Error(message); error.code = code; error.statusCode = statusCode; return error; };
const configureCloudinary = () => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) throw storageError("AVATAR_STORAGE_NOT_CONFIGURED", "Avatar video storage is not configured.", 503);
  cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET, secure: true });
};
const assertHeyGenMediaUrl = (value) => {
  let url; try { url = new URL(value); } catch { throw storageError("AVATAR_PROVIDER_INVALID_RESPONSE", "TerraPeak Avatar returned an invalid result."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !(url.hostname === "heygen.ai" || url.hostname.endsWith(".heygen.ai"))) {
    throw storageError("AVATAR_PROVIDER_INVALID_RESPONSE", "TerraPeak Avatar returned an invalid result.");
  }
  return url.toString();
};
const isMp4 = (buffer) => buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp";
export const readBoundedResponse = async (response, maxBytes) => {
  const declaredBytes = Number(response.headers?.["content-length"] || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) throw new Error("response too large");
  if (Buffer.isBuffer(response.data) || response.data instanceof Uint8Array) {
    const buffer = Buffer.from(response.data);
    if (buffer.length > maxBytes) throw new Error("response too large");
    return buffer;
  }
  if (!response.data || typeof response.data[Symbol.asyncIterator] !== "function") throw new Error("invalid response stream");
  const chunks = []; let total = 0;
  for await (const chunk of response.data) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += buffer.length;
    if (total > maxBytes) { response.data.destroy?.(); throw new Error("response too large"); }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
};
export const copyProviderVideoToPrivateStorage = async ({ resultUrl, companyId, userId, videoId, fetchVideo = axios.get, uploadBuffer }) => {
  const safeUrl = assertHeyGenMediaUrl(resultUrl);
  let buffer;
  try {
    const response = await fetchVideo(safeUrl, { responseType: "stream", timeout: 60_000, maxRedirects: 0, validateStatus: (status) => status === 200 });
    buffer = await readBoundedResponse(response, MAX_VIDEO_BYTES); const contentType = String(response.headers?.["content-type"] || "").split(";")[0].toLowerCase();
    if (!buffer.length || buffer.length > MAX_VIDEO_BYTES || contentType !== "video/mp4" || !isMp4(buffer)) throw new Error("invalid video");
  } catch (error) { if (error?.code?.startsWith?.("AVATAR_")) throw error; throw storageError("AVATAR_VIDEO_DELIVERY_FAILED", "Generated avatar video could not be stored privately."); }
  if (uploadBuffer) return uploadBuffer({ buffer, mimeType: "video/mp4" });
  configureCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: `terrapeak/digital-clone/${companyId}/${userId}/avatar/videos`, resource_type: "video", type: "authenticated", use_filename: true, unique_filename: true, filename_override: `avatar-test-${videoId}.mp4` }, (error, result) => error ? reject(storageError("AVATAR_STORAGE_UPLOAD_FAILED", "Generated avatar video could not be stored privately.")) : resolve(result));
    stream.end(buffer);
  });
};
const signedInternalUrl = (storagePublicId) => { configureCloudinary(); return cloudinary.url(storagePublicId, { secure: true, sign_url: true, type: "authenticated", resource_type: "video" }); };
export const streamPrivateAvatarVideo = async ({ storagePublicId, fetchVideo = axios.get }) => {
  try { const response = await fetchVideo(signedInternalUrl(storagePublicId), { responseType: "stream", timeout: 20_000, maxContentLength: MAX_VIDEO_BYTES, maxBodyLength: MAX_VIDEO_BYTES, maxRedirects: 0, validateStatus: (status) => status === 200 }); return response.data; }
  catch { throw storageError("AVATAR_VIDEO_DELIVERY_FAILED", "Avatar video is temporarily unavailable."); }
};
export const deletePrivateAvatarVideo = async ({ storagePublicId }) => {
  configureCloudinary();
  const result = await cloudinary.uploader.destroy(storagePublicId, { resource_type: "video", type: "authenticated", invalidate: true });
  if (!["ok", "not found"].includes(result?.result)) throw storageError("AVATAR_STORAGE_DELETE_FAILED", "Avatar video storage cleanup failed.");
  return result;
};
export const streamHeyGenPreview = async ({ previewUrl, fetchPreview = axios.get }) => {
  try {
    const response = await fetchPreview(assertHeyGenMediaUrl(previewUrl), { responseType: "stream", timeout: 12_000, maxRedirects: 0, validateStatus: (status) => status === 200 });
    const buffer = await readBoundedResponse(response, MAX_PREVIEW_BYTES); const mimeType = String(response.headers?.["content-type"] || "").split(";")[0].toLowerCase();
    const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const webp = buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
    if (!buffer.length || !({ "image/jpeg": jpeg, "image/png": png, "image/webp": webp }[mimeType])) throw new Error("invalid preview");
    return { stream: Readable.from([buffer]), mimeType };
  }
  catch { throw storageError("AVATAR_PREVIEW_UNAVAILABLE", "Avatar preview is temporarily unavailable."); }
};
const audioSignatureMatches = (buffer, mimeType) => {
  const mp3 = buffer.length >= 3 && (buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0));
  const wav = buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE";
  const ogg = buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "OggS";
  const webm = buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  const mp4 = buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
  const aac = buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
  return Boolean({
    "audio/mpeg": mp3,
    "audio/wav": wav,
    "audio/x-wav": wav,
    "audio/ogg": ogg,
    "audio/webm": webm,
    "audio/mp4": mp4,
    "audio/x-m4a": mp4,
    "audio/aac": aac,
  }[mimeType]);
};
export const streamHeyGenVoicePreview = async ({ previewUrl, fetchPreview = axios.get }) => {
  try {
    const response = await fetchPreview(assertHeyGenMediaUrl(previewUrl), { responseType: "stream", timeout: 12_000, maxContentLength: MAX_VOICE_PREVIEW_BYTES, maxBodyLength: MAX_VOICE_PREVIEW_BYTES, maxRedirects: 0, validateStatus: (status) => status === 200 });
    const buffer = await readBoundedResponse(response, MAX_VOICE_PREVIEW_BYTES);
    const mimeType = String(response.headers?.["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!buffer.length || !audioSignatureMatches(buffer, mimeType)) throw new Error("invalid audio preview");
    return { stream: Readable.from([buffer]), mimeType };
  } catch {
    throw storageError("AVATAR_PROVIDER_VOICE_PREVIEW_UNAVAILABLE", "Avatar voice preview is temporarily unavailable.", 502);
  }
};
export { assertHeyGenMediaUrl };
