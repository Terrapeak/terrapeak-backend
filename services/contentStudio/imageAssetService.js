import dns from "node:dns/promises";
import net from "node:net";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import { google } from "googleapis";
import ContentStudioImageAsset from "../../models/contentStudioImageAsset.js";
import User from "../../models/user.js";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const makeError = (message, statusCode = 400, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
};

const configureCloudinary = () => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw makeError("Image storage is not configured.", 503, "IMAGE_STORAGE_NOT_CONFIGURED");
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
};

const uploadBuffer = async ({ buffer, companyId, filename }) => {
  configureCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `terrapeak/content-studio/${companyId}`,
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        filename_override: filename,
      },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    stream.end(buffer);
  });
};

const isPrivateAddress = (address) => {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168);
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe80:");
};

const validateRemoteUrl = async (rawUrl) => {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw makeError("Enter a valid image URL."); }
  if (parsed.protocol !== "https:") throw makeError("Image URLs must use HTTPS.");
  if (["localhost", "0.0.0.0"].includes(parsed.hostname.toLowerCase())) {
    throw makeError("That image URL is not allowed.");
  }
  const addresses = await dns.lookup(parsed.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw makeError("That image URL is not allowed.");
  }
  return parsed.toString();
};

const saveAsset = async ({ companyId, userId, source, provider, externalId = "", filename, mimeType, prompt = "", upload, metadata = {} }) =>
  ContentStudioImageAsset.create({
    companyId,
    createdByUserId: userId,
    source,
    provider,
    externalId,
    filename,
    mimeType,
    prompt,
    url: upload.secure_url,
    storagePublicId: upload.public_id,
    width: upload.width,
    height: upload.height,
    bytes: upload.bytes,
    metadata,
  });

export const uploadLocalImages = async ({ companyId, userId, files }) => {
  if (!files?.length) throw makeError("Select at least one image.");
  return Promise.all(files.map(async (file) => {
    const upload = await uploadBuffer({ buffer: file.buffer, companyId, filename: file.originalname });
    return saveAsset({
      companyId, userId, source: "local", provider: "cloudinary",
      filename: file.originalname, mimeType: file.mimetype, upload,
    });
  }));
};

export const importImageUrl = async ({ companyId, userId, imageUrl }) => {
  const safeUrl = await validateRemoteUrl(imageUrl);
  const response = await axios.get(safeUrl, {
    responseType: "arraybuffer",
    timeout: 12000,
    maxContentLength: MAX_IMAGE_BYTES,
    maxBodyLength: MAX_IMAGE_BYTES,
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 300,
    headers: { Accept: "image/jpeg,image/png,image/webp" },
  });
  const mimeType = String(response.headers["content-type"] || "").split(";")[0].toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) throw makeError("The URL must return a JPEG, PNG, or WebP image.");
  const buffer = Buffer.from(response.data);
  if (buffer.length > MAX_IMAGE_BYTES) throw makeError("The image must be 5 MB or smaller.");
  const filename = decodeURIComponent(new URL(safeUrl).pathname.split("/").pop() || "imported-image");
  const upload = await uploadBuffer({ buffer, companyId, filename });
  return saveAsset({
    companyId, userId, source: "url", provider: "cloudinary",
    externalId: safeUrl, filename, mimeType, upload,
  });
};

const getDriveClient = async (userId) => {
  const user = await User.findById(userId).select("isGoogleOauth googleAccessToken googleRefreshToken");
  if (!user?.isGoogleOauth || !user.googleAccessToken) {
    throw makeError("Connect Google Drive before browsing images.", 409, "GOOGLE_DRIVE_NOT_CONNECTED");
  }
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  auth.setCredentials({
    access_token: user.googleAccessToken,
    refresh_token: user.googleRefreshToken,
  });
  auth.on("tokens", async (tokens) => {
    const updates = {};
    if (tokens.access_token) updates.googleAccessToken = tokens.access_token;
    if (tokens.refresh_token) updates.googleRefreshToken = tokens.refresh_token;
    if (Object.keys(updates).length) await User.updateOne({ _id: userId }, { $set: updates });
  });
  return google.drive({ version: "v3", auth });
};

const mapDriveError = (error) => {
  const status = error?.response?.status || error?.code;
  if (status === 401 || status === 403) {
    throw makeError(
      "Google Drive permission is missing or expired. Reconnect Google with Drive access.",
      409,
      "GOOGLE_DRIVE_RECONNECT_REQUIRED",
    );
  }
  throw error;
};

export const listGoogleDriveImages = async ({ userId, pageToken }) => {
  try {
    const drive = await getDriveClient(userId);
    const response = await drive.files.list({
      q: "trashed = false and mimeType contains 'image/'",
      pageSize: 30,
      pageToken: pageToken || undefined,
      orderBy: "modifiedTime desc",
      fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink,iconLink)",
    });
    return response.data;
  } catch (error) { return mapDriveError(error); }
};

export const importGoogleDriveImage = async ({ companyId, userId, fileId }) => {
  try {
    const drive = await getDriveClient(userId);
    const metadata = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,size,modifiedTime",
    });
    const mimeType = metadata.data.mimeType;
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) throw makeError("That Drive file type is not supported.");
    if (Number(metadata.data.size || 0) > MAX_IMAGE_BYTES) throw makeError("The Drive image must be 5 MB or smaller.");
    const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);
    const upload = await uploadBuffer({ buffer, companyId, filename: metadata.data.name });
    return saveAsset({
      companyId, userId, source: "google-drive", provider: "google-drive",
      externalId: metadata.data.id, filename: metadata.data.name, mimeType, upload,
      metadata: { modifiedTime: metadata.data.modifiedTime },
    });
  } catch (error) { return mapDriveError(error); }
};

export const generateImagenAssets = async ({ companyId, userId, prompt, aspectRatio = "1:1", count = 1 }) => {
  const apiKey = process.env.CONTENT_STUDIO_IMAGE_GEMINI_API_KEY;
  if (!apiKey) throw makeError("The separate Content Studio image key is not configured.", 503, "IMAGE_GENERATOR_NOT_CONFIGURED");
  const model = process.env.CONTENT_STUDIO_IMAGE_MODEL || "imagen-4.0-generate-001";
  const safeCount = Math.min(Math.max(Number(count) || 1, 1), 4);
  const ratios = new Set(["1:1", "3:4", "4:3", "9:16", "16:9"]);
  const normalizedPrompt = String(prompt || "").trim();
  const requestConfig = {
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    timeout: 90000,
  };

  let generated;
  if (model.startsWith("imagen-")) {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predict`,
      {
        instances: [{ prompt: normalizedPrompt }],
        parameters: {
          sampleCount: safeCount,
          aspectRatio: ratios.has(aspectRatio) ? aspectRatio : "1:1",
        },
      },
      requestConfig,
    );
    generated = (response.data?.predictions || []).map((prediction) => ({
      bytes: prediction.bytesBase64Encoded || prediction.image?.imageBytes,
      mimeType: prediction.mimeType || "image/png",
    }));
  } else {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        contents: [{ parts: [{ text: normalizedPrompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      },
      requestConfig,
    );
    generated = (response.data?.candidates || []).flatMap((candidate) =>
      (candidate.content?.parts || [])
        .filter((part) => part.inlineData?.data)
        .map((part) => ({
          bytes: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
        })),
    ).slice(0, safeCount);
  }

  if (!generated.length) throw makeError("Google did not return an image.", 502);
  return Promise.all(generated.map(async ({ bytes, mimeType }, index) => {
    if (!bytes) throw makeError("Google returned an invalid image response.", 502);
    const filename = `generated-${Date.now()}-${index + 1}.png`;
    const upload = await uploadBuffer({ buffer: Buffer.from(bytes, "base64"), companyId, filename });
    return saveAsset({
      companyId, userId, source: "generated", provider: "google-imagen",
      filename, mimeType, prompt, upload, metadata: { model, aspectRatio },
    });
  }));
};

export const listImageAssets = ({ companyId, source }) => {
  const query = { companyId };
  if (source) query.source = source;
  return ContentStudioImageAsset.find(query).sort({ createdAt: -1 }).limit(100).lean();
};

export const deleteImageAsset = async ({ companyId, assetId }) => {
  const asset = await ContentStudioImageAsset.findOne({ _id: assetId, companyId });
  if (!asset) return null;
  configureCloudinary();
  await cloudinary.uploader.destroy(asset.storagePublicId, { resource_type: "image" });
  await asset.deleteOne();
  return asset.toObject();
};
