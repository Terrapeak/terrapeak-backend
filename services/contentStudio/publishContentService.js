import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import ContentStudioContent from "../../models/contentStudioContent.js";
import ContentStudioImageAsset from "../../models/contentStudioImageAsset.js";
import { validateCompanyImages } from "./imageOwnershipService.js";
import { recordImageAudit } from "./imageAuditService.js";

const makeError = (message, statusCode = 400, code = "") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
};

const configureCloudinary = () => {
  const {
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET,
  } = process.env;

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw makeError(
      "Image storage is not configured.",
      503,
      "IMAGE_STORAGE_NOT_CONFIGURED",
    );
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
};

const uniqueAssetIds = (content) =>
  [...new Set(
    (content.images || [])
      .map((image) => String(image.assetId || ""))
      .filter(Boolean),
  )];

const escapeRegExp = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const buildPublishedContent = ({ content, assets }) => {
  let published = String(content || "");

  for (const asset of assets) {
    if (!asset.publishedUrl) {
      throw makeError(
        "Every attached image must have a public rendition before publication.",
        409,
        "PUBLIC_RENDITION_MISSING",
      );
    }

    const assetId = String(asset._id);
    published = published.replace(
      new RegExp(`asset:${escapeRegExp(assetId)}`, "gi"),
      asset.publishedUrl,
    );
  }

  return published;
};

const createPublicRendition = async ({ companyId, asset }) => {
  configureCloudinary();

  const sourceUrl = cloudinary.url(asset.storagePublicId, {
    resource_type: "image",
    type: asset.deliveryType || "authenticated",
    secure: true,
    sign_url: (asset.deliveryType || "authenticated") === "authenticated",
  });

  return cloudinary.uploader.upload(sourceUrl, {
    folder: `terrapeak/content-studio-published/${companyId}`,
    public_id: `asset-${asset._id}`,
    resource_type: "image",
    type: "upload",
    overwrite: false,
  });
};

const destroyPublicRendition = async (publicId) => {
  if (!publicId) return;

  configureCloudinary();
  await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    type: "upload",
    invalidate: true,
  });
};

export const publishContent = async ({ companyId, userId, contentId }) => {
  if (!mongoose.Types.ObjectId.isValid(contentId)) {
    throw makeError("A valid content ID is required.");
  }

  const content = await ContentStudioContent.findOne({
    _id: contentId,
    companyId,
  });

  if (!content) return null;

  const assetIds = uniqueAssetIds(content);

  await validateCompanyImages({
    companyId,
    userId,
    assetIds,
    action: "publish",
  });

  const assets = assetIds.length
    ? await ContentStudioImageAsset.find({
        _id: { $in: assetIds },
        companyId,
        status: "active",
      })
    : [];

  if (assets.length !== assetIds.length) {
    throw makeError(
      "One or more attached images are unavailable.",
      409,
      "CONTENT_IMAGE_UNAVAILABLE",
    );
  }

  const createdPublicIds = [];
  let publishedStorageBytes = 0;

  try {
    for (const asset of assets) {
      if (!asset.publishedUrl) {
        const uploaded = await createPublicRendition({ companyId, asset });

        asset.publishedUrl = uploaded.secure_url || uploaded.url || "";
        asset.publishedStoragePublicId = uploaded.public_id || "";
        asset.publishedBytes = Math.max(0, Number(uploaded.bytes) || 0);
        asset.publishedAt = new Date();
        asset.publishedByUserId = userId || null;

        if (!asset.publishedUrl || !asset.publishedStoragePublicId) {
          throw makeError(
            "The public image rendition could not be created.",
            502,
            "PUBLIC_RENDITION_FAILED",
          );
        }

        await asset.save();
        createdPublicIds.push(asset.publishedStoragePublicId);

        await recordImageAudit({
          companyId,
          userId,
          imageId: asset._id,
          eventType: "image.published",
          source: asset.source || "",
          provider: "cloudinary",
          fileSize: asset.publishedBytes,
          secureMetadata: {
            publishedStoragePublicId: asset.publishedStoragePublicId,
            contentId: String(content._id),
          },
        });
      }

      publishedStorageBytes += Math.max(0, Number(asset.publishedBytes) || 0);
    }

    const publishedContent = buildPublishedContent({
      content: content.content,
      assets,
    });

    content.publishedContent = publishedContent;
    content.publishedAt = new Date();
    content.publishedByUserId = userId || null;
    content.publishVersion = Math.max(0, Number(content.publishVersion) || 0) + 1;

    await content.save();

    return {
      content: content.toObject(),
      publishedStorageBytes,
    };
  } catch (error) {
    await Promise.allSettled(
      createdPublicIds.map((publicId) => destroyPublicRendition(publicId)),
    );

    if (createdPublicIds.length) {
      await ContentStudioImageAsset.updateMany(
        { companyId, publishedStoragePublicId: { $in: createdPublicIds } },
        {
          $set: {
            publishedUrl: "",
            publishedStoragePublicId: "",
            publishedBytes: 0,
            publishedAt: null,
            publishedByUserId: null,
          },
        },
      );
    }

    throw error;
  }
};

export const getPublishedContent = async ({ companyId, contentId }) => {
  if (!mongoose.Types.ObjectId.isValid(contentId)) return null;

  const content = await ContentStudioContent.findOne({
    _id: contentId,
    companyId,
    publishedAt: { $ne: null },
    publishedContent: { $ne: "" },
  })
    .select("title publishedContent publishedAt publishVersion")
    .lean();

  if (!content) return null;

  return {
    title: content.title,
    publishedContent: content.publishedContent,
    publishedAt: content.publishedAt,
    publishVersion: content.publishVersion,
  };
};
