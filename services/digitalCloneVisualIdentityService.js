import mongoose from "mongoose";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import DigitalCloneProfile from "../models/digitalCloneProfile.js";
import DigitalCloneVisualAsset from "../models/digitalCloneVisualAsset.js";
import { normalizeContentStudioImage } from "./contentStudio/imageNormalizationService.js";

const MAX_ACTIVE_ASSETS = 30;
const ALLOWED_METADATA_FIELDS = new Set(["role", "lookName", "notes", "approvedForCloneUse"]);
const ROLES = new Set(["reference", "primary", "look-reference"]);

const makeError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const configureCloudinary = () => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw makeError("Identity media storage is not configured.", 503, "IDENTITY_STORAGE_NOT_CONFIGURED");
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
};

const uploadPrivateBuffer = ({ buffer, companyId, userId, filename }) => {
  configureCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `terrapeak/digital-clone/${companyId}/${userId}/identity`,
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

const destroyPrivateAsset = async (storagePublicId) => {
  configureCloudinary();
  const result = await cloudinary.uploader.destroy(storagePublicId, {
    resource_type: "image",
    type: "authenticated",
    invalidate: true,
  });
  if (!["ok", "not found"].includes(result?.result)) {
    throw makeError("Identity media could not be removed from private storage.", 502, "IDENTITY_STORAGE_DELETE_FAILED");
  }
};

export const assertDigitalCloneMediaConsent = async ({ companyId, userId }) => {
  const profile = await DigitalCloneProfile.findOne({ companyId, userId }).select("status consent").lean();
  const consent = profile?.consent;
  const consentStatusActive = ["consented", "setup"].includes(profile?.status);
  if (
    !consentStatusActive ||
    !consent?.acceptedAt ||
    !consent?.identityConfirmed ||
    !consent?.mediaRightsConfirmed ||
    !consent?.aiRepresentationConsent
  ) {
    throw makeError(
      "Confirm identity, media rights, and AI representation consent before managing identity references.",
      409,
      "DIGITAL_CLONE_MEDIA_CONSENT_REQUIRED",
    );
  }
  return profile;
};

const validateAssetId = (assetId) => {
  if (!mongoose.Types.ObjectId.isValid(assetId)) {
    throw makeError("Identity reference not found.", 404, "IDENTITY_ASSET_NOT_FOUND");
  }
};

const findOwnedAsset = async ({ companyId, userId, assetId, includeDeleted = false }) => {
  validateAssetId(assetId);
  const asset = await DigitalCloneVisualAsset.findOne({
    _id: assetId,
    companyId,
    userId,
    ...(includeDeleted ? {} : { status: { $ne: "deleted" } }),
  }).select("+primaryScopeKey");
  if (!asset) throw makeError("Identity reference not found.", 404, "IDENTITY_ASSET_NOT_FOUND");
  return asset;
};

export const serializeIdentityAsset = (asset) => {
  const value = typeof asset?.toObject === "function" ? asset.toObject() : { ...asset };
  const response = { ...value };
  delete response.storagePublicId;
  delete response.primaryScopeKey;
  delete response.url;
  return response;
};

export const getIdentityAssetDeliveryStream = async ({
  companyId,
  userId,
  assetId,
  fetchStream = axios.get,
}) => {
  await assertDigitalCloneMediaConsent({ companyId, userId });
  const asset = await findOwnedAsset({ companyId, userId, assetId });
  if (asset.status !== "active") {
    throw makeError("Identity reference not found.", 404, "IDENTITY_ASSET_NOT_FOUND");
  }
  configureCloudinary();
  const internalUrl = cloudinary.url(asset.storagePublicId, {
    secure: true,
    sign_url: true,
    type: "authenticated",
    resource_type: "image",
  });
  try {
    const response = await fetchStream(internalUrl, {
      responseType: "stream",
      timeout: 12_000,
      maxContentLength: 5 * 1024 * 1024,
      maxBodyLength: 5 * 1024 * 1024,
      maxRedirects: 0,
      validateStatus: (status) => status === 200,
    });
    return { asset, stream: response.data };
  } catch {
    throw makeError(
      "Identity media is temporarily unavailable.",
      502,
      "IDENTITY_DELIVERY_FAILED",
    );
  }
};

export const uploadIdentityAssets = async ({ companyId, userId, files, uploadBuffer = uploadPrivateBuffer }) => {
  if (!files?.length) throw makeError("Select at least one identity reference.", 400, "IDENTITY_IMAGES_REQUIRED");
  if (files.length > 10) throw makeError("Upload at most 10 identity references at once.", 400, "IDENTITY_UPLOAD_LIMIT");
  const activeCount = await DigitalCloneVisualAsset.countDocuments({ companyId, userId, status: "active" });
  if (activeCount + files.length > MAX_ACTIVE_ASSETS) {
    throw makeError(
      `A Digital Clone can have at most ${MAX_ACTIVE_ASSETS} active identity references.`,
      409,
      "IDENTITY_ACTIVE_LIMIT",
    );
  }

  const created = [];
  const uploadedIds = [];
  try {
    for (const file of files) {
      const normalized = await normalizeContentStudioImage({
        buffer: file.buffer,
        filename: file.originalname,
        declaredMimeType: file.mimetype,
      });
      const upload = await uploadBuffer({
        buffer: normalized.buffer,
        companyId,
        userId,
        filename: normalized.filename,
      });
      uploadedIds.push(upload.public_id);
      created.push(await DigitalCloneVisualAsset.create({
        companyId,
        userId,
        filename: normalized.filename,
        mimeType: normalized.mimeType,
        storagePublicId: upload.public_id,
        width: upload.width || normalized.width,
        height: upload.height || normalized.height,
        bytes: upload.bytes || normalized.bytes,
        role: "reference",
        approvedForCloneUse: false,
      }));
    }
    return created;
  } catch (error) {
    await Promise.allSettled(uploadedIds.map((publicId) => destroyPrivateAsset(publicId)));
    if (created.length) {
      await DigitalCloneVisualAsset.deleteMany({
        _id: { $in: created.map((asset) => asset._id) },
        companyId,
        userId,
      });
    }
    throw error;
  }
};

export const listIdentityAssets = ({ companyId, userId }) =>
  DigitalCloneVisualAsset.find({ companyId, userId }).sort({ createdAt: -1 });

export const normalizeIdentityMetadata = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw makeError("Identity metadata must be an object.", 400, "IDENTITY_METADATA_INVALID");
  }
  const unexpected = Object.keys(body).filter((key) => !ALLOWED_METADATA_FIELDS.has(key));
  if (unexpected.length) throw makeError("Identity metadata contains unexpected fields.", 400, "IDENTITY_METADATA_INVALID");
  const update = {};
  if (body.role !== undefined) {
    if (!ROLES.has(body.role)) throw makeError("Identity reference role is invalid.", 400, "IDENTITY_ROLE_INVALID");
    update.role = body.role;
  }
  for (const [field, limit] of [["lookName", 120], ["notes", 1000]]) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string") throw makeError(`${field} must be text.`, 400, "IDENTITY_METADATA_INVALID");
    const value = body[field].trim();
    if (value.length > limit) throw makeError(`${field} is too long.`, 400, "IDENTITY_METADATA_INVALID");
    update[field] = value;
  }
  if (body.approvedForCloneUse !== undefined) {
    if (typeof body.approvedForCloneUse !== "boolean") {
      throw makeError("approvedForCloneUse must be true or false.", 400, "IDENTITY_METADATA_INVALID");
    }
    update.approvedForCloneUse = body.approvedForCloneUse;
  }
  return update;
};

export const updateIdentityAsset = async ({ companyId, userId, assetId, body }) => {
  const asset = await findOwnedAsset({ companyId, userId, assetId });
  if (asset.status !== "active") {
    throw makeError("Only active identity references can be updated.", 409, "IDENTITY_ASSET_INACTIVE");
  }
  const update = normalizeIdentityMetadata(body);
  if (update.role === "primary") {
    await DigitalCloneVisualAsset.updateMany(
      { companyId, userId, status: "active", role: "primary", _id: { $ne: asset._id } },
      { $set: { role: "reference" }, $unset: { primaryScopeKey: "" } },
    );
    asset.primaryScopeKey = `${companyId}:${userId}`;
  } else if (update.role && asset.role === "primary") {
    asset.primaryScopeKey = undefined;
  }
  Object.assign(asset, update);
  try {
    await asset.save();
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.primaryScopeKey) {
      throw makeError(
        "Another identity reference became primary at the same time. Refresh and try again.",
        409,
        "IDENTITY_PRIMARY_CONFLICT",
      );
    }
    throw error;
  }
  return asset;
};

export const revokeIdentityAsset = async ({ companyId, userId, assetId }) => {
  const asset = await findOwnedAsset({ companyId, userId, assetId });
  if (asset.status === "revoked") return asset;
  asset.status = "revoked";
  asset.approvedForCloneUse = false;
  asset.primaryScopeKey = undefined;
  asset.revokedAt = new Date();
  await asset.save();
  return asset;
};

export const deleteIdentityAsset = async ({ companyId, userId, assetId, destroyAsset = destroyPrivateAsset }) => {
  const asset = await findOwnedAsset({ companyId, userId, assetId });
  await destroyAsset(asset.storagePublicId);
  asset.status = "deleted";
  asset.approvedForCloneUse = false;
  asset.primaryScopeKey = undefined;
  asset.deletedAt = new Date();
  await asset.save();
  return asset;
};

export const getApprovedIdentityAssetsForProvider = async ({ companyId, userId }) => {
  await assertDigitalCloneMediaConsent({ companyId, userId });
  return DigitalCloneVisualAsset.find({
    companyId,
    userId,
    status: "active",
    approvedForCloneUse: true,
  }).lean();
};

export const DIGITAL_CLONE_IDENTITY_LIMITS = Object.freeze({
  maxFilesPerRequest: 10,
  maxActiveAssets: MAX_ACTIVE_ASSETS,
  maxFileBytes: 5 * 1024 * 1024,
});
