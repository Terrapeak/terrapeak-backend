import dns from "node:dns/promises";
import net from "node:net";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import { google } from "googleapis";
import ContentStudioImageAsset from "../../models/contentStudioImageAsset.js";
import Company from "../../models/company.js";
import User from "../../models/user.js";
import { resolveCompanyContentStudioKeys } from "../../utils/contentStudioCredentialEncryption.js";
import { findCompanyImageOrThrow } from "./imageOwnershipService.js";
import { recordImageAudit } from "./imageAuditService.js";
import { releaseStoredImageUsage } from "./contentStudioUsageService.js";
import { normalizeContentStudioImage } from "./imageNormalizationService.js";

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
        type: "authenticated",
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

const saveAsset = async ({ companyId, userId, source, provider, externalId = "", filename, mimeType, prompt = "", upload, metadata = {} }) => {
  const asset = await ContentStudioImageAsset.create({
    companyId,
    createdByUserId: userId,
    source,
    provider,
    externalId,
    visibility: "workspace-only",
    deliveryType: "authenticated",
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
  const eventType = source === "local"
    ? "image.uploaded"
    : source === "url"
      ? "image.imported.url"
      : source === "google-drive"
        ? "image.imported.drive"
        : "image.generated";
  await recordImageAudit({
    companyId,
    userId,
    imageId: asset._id,
    eventType,
    source,
    provider,
    fileSize: asset.bytes,
    model: metadata?.model || "",
  });
  return asset;
};

export const uploadLocalImages = async ({ companyId, userId, files }) => {
  if (!files?.length) throw makeError("Select at least one image.");
  return Promise.all(files.map(async (file) => {
    const normalized = await normalizeContentStudioImage({
      buffer: file.buffer,
      filename: file.originalname,
      declaredMimeType: file.mimetype,
    });
    const upload = await uploadBuffer({
      buffer: normalized.buffer,
      companyId,
      filename: normalized.filename,
    });
    return saveAsset({
      companyId, userId, source: "local", provider: "cloudinary",
      filename: normalized.filename, mimeType: normalized.mimeType, upload,
      metadata: {
        originalFilename: file.originalname,
        originalMimeType: normalized.originalMimeType,
        normalized: true,
      },
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
  const normalized = await normalizeContentStudioImage({
    buffer,
    filename,
    declaredMimeType: mimeType,
  });
  const upload = await uploadBuffer({
    buffer: normalized.buffer,
    companyId,
    filename: normalized.filename,
  });
  return saveAsset({
    companyId, userId, source: "url", provider: "cloudinary",
    externalId: safeUrl, filename: normalized.filename,
    mimeType: normalized.mimeType, upload,
    metadata: { originalMimeType: normalized.originalMimeType, normalized: true },
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
    const normalized = await normalizeContentStudioImage({
      buffer,
      filename: metadata.data.name,
      declaredMimeType: mimeType,
    });
    const upload = await uploadBuffer({
      buffer: normalized.buffer,
      companyId,
      filename: normalized.filename,
    });
    return saveAsset({
      companyId, userId, source: "google-drive", provider: "google-drive",
      externalId: metadata.data.id, filename: normalized.filename,
      mimeType: normalized.mimeType, upload,
      metadata: {
        modifiedTime: metadata.data.modifiedTime,
        originalFilename: metadata.data.name,
        originalMimeType: normalized.originalMimeType,
        normalized: true,
      },
    });
  } catch (error) { return mapDriveError(error); }
};

export const generateImagenAssets = async ({ companyId, userId, prompt, aspectRatio = "1:1", count = 1 }) => {
  const company = await Company.findById(companyId).select("contentStudioAiConfig");
  if (!company) throw makeError("Company not found.", 404, "COMPANY_NOT_FOUND");

  const config = company.contentStudioAiConfig || {};
  const { imageKey: apiKey } = resolveCompanyContentStudioKeys(company);
  if (!apiKey) {
    throw makeError(
      "Content Studio image generation is not configured for this company.",
      503,
      "IMAGE_GENERATOR_NOT_CONFIGURED",
    );
  }

  const configuredModel = config.imageModel || "gemini-2.5-flash-image";
  // Imagen 4 is deprecated and can return MODEL_NOT_FOUND for projects that
  // no longer have access. Preserve stored legacy settings while routing
  // generation to Google's supported replacement model.
  const model = configuredModel.startsWith("imagen-")
    ? "gemini-2.5-flash-image"
    : configuredModel;
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
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: ratios.has(aspectRatio) ? aspectRatio : "1:1",
          },
        },
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
    const normalized = await normalizeContentStudioImage({
      buffer: Buffer.from(bytes, "base64"),
      filename,
      declaredMimeType: mimeType,
    });
    const upload = await uploadBuffer({
      buffer: normalized.buffer,
      companyId,
      filename: normalized.filename,
    });
    return saveAsset({
      companyId, userId, source: "generated", provider: "google-gemini-image",
      filename: normalized.filename, mimeType: normalized.mimeType, prompt, upload,
      metadata: {
        model, configuredModel, aspectRatio,
        originalMimeType: normalized.originalMimeType,
        normalized: true,
      },
    });
  }));
};

export const listImageAssets = ({ companyId, source }) => {
  const query = { companyId, status: "active" };
  if (source) query.source = source;
  return ContentStudioImageAsset.find(query).sort({ createdAt: -1 }).limit(100).lean();
};

export const deleteImageAsset = async ({ companyId, userId, assetId }) => {
  const asset = await findCompanyImageOrThrow({
    companyId,
    assetId,
    userId,
    action: "delete",
  });

  if (asset.referenceCount > 0) {
    await recordImageAudit({
      companyId,
      userId,
      imageId: asset._id,
      eventType: "image.deletion_blocked",
      source: asset.source,
      provider: asset.provider,
      fileSize: asset.bytes,
      secureMetadata: { referenceCount: asset.referenceCount },
    });
    throw makeError(
      "This image is still used by saved content.",
      409,
      "IMAGE_IS_IN_USE",
    );
  }

  const retentionDays = Math.min(
    Math.max(Number(process.env.CONTENT_STUDIO_IMAGE_RETENTION_DAYS) || 30, 1),
    90,
  );
  asset.status = "deleted";
  asset.deletedAt = new Date();
  asset.deletedByUserId = userId;
  asset.purgeAfter = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
  await asset.save();
  await recordImageAudit({
    companyId,
    userId,
    imageId: asset._id,
    eventType: "image.deleted",
    source: asset.source,
    provider: asset.provider,
    fileSize: asset.bytes,
    secureMetadata: { purgeAfter: asset.purgeAfter },
  });
  await releaseStoredImageUsage({
    companyId,
    storageBytes: asset.bytes,
  });
  return asset.toObject();
};
