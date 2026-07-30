import { v2 as cloudinary } from "cloudinary";
import { findCompanyImageOrThrow } from "./imageOwnershipService.js";

const configureCloudinary = () => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    const error = new Error("Image storage is not configured.");
    error.statusCode = 503;
    error.code = "IMAGE_STORAGE_NOT_CONFIGURED";
    throw error;
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
};

const requestOrigin = (req) => {
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const forwardedHost = String(req.get("x-forwarded-host") || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "https";
  const host = forwardedHost || req.get("host");
  return `${protocol}://${host}`;
};

export const serializeImageAssetForClient = ({ req, asset }) => {
  const value = typeof asset?.toObject === "function" ? asset.toObject() : { ...asset };
  const visibility = value.visibility || "legacy-public";
  const deliveryType = value.deliveryType || "upload";
  const isPublic = ["legacy-public", "published-public"].includes(visibility) &&
    deliveryType === "upload";
  if (!isPublic) configureCloudinary();
  const response = {
    ...value,
    visibility,
    deliveryType,
    url: isPublic
      ? value.url
      : cloudinary.url(value.storagePublicId, {
          secure: true,
          sign_url: true,
          type: "authenticated",
          resource_type: "image",
          expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
        }),
  };
  delete response.storagePublicId;
  if (!isPublic) delete response.externalId;
  return response;
};

export const createImageDeliveryUrl = async ({ companyId, userId, assetId }) => {
  const asset = await findCompanyImageOrThrow({
    companyId,
    userId,
    assetId,
    action: "deliver",
  });

  if (["legacy-public", "published-public"].includes(asset.visibility) &&
      asset.deliveryType === "upload") {
    return asset.url;
  }

  configureCloudinary();
  return cloudinary.url(asset.storagePublicId, {
    secure: true,
    sign_url: true,
    type: "authenticated",
    resource_type: "image",
    expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
  });
};
