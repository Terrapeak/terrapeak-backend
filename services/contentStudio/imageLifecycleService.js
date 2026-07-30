import { v2 as cloudinary } from "cloudinary";
import ContentStudioImageAsset from "../../models/contentStudioImageAsset.js";
import { recordImageAudit } from "./imageAuditService.js";
import { releaseStoredImageUsage } from "./contentStudioUsageService.js";

const configureCloudinary = () => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    const error = new Error("Image storage is not configured.");
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

const listCloudinaryResources = async () => {
  configureCloudinary();
  const resources = [];
  for (const prefix of ["terrapeak/content-studio/", "terrapeak/content-studio-published/"]) {
    for (const type of ["upload", "authenticated"]) {
      let nextCursor;
      do {
        const page = await cloudinary.api.resources({
          type,
          resource_type: "image",
          prefix,
          max_results: 500,
          next_cursor: nextCursor,
        });
        resources.push(...(page.resources || []).map((resource) => ({
          ...resource,
          deliveryType: type,
        })));
        nextCursor = page.next_cursor;
      } while (nextCursor);
    }
  }
  return resources;
};

export const expireTemporaryImages = async ({ now = new Date(), maxAgeHours = 24 } = {}) => {
  const cutoff = new Date(now.getTime() - maxAgeHours * 60 * 60 * 1000);
  const temporary = await ContentStudioImageAsset.find({
    status: "temporary",
    referenceCount: 0,
    createdAt: { $lte: cutoff },
  });
  for (const asset of temporary) {
    asset.status = "deleted";
    asset.deletedAt = now;
    asset.purgeAfter = now;
    await asset.save();
    if (asset.publishedStoragePublicId) {
      await cloudinary.uploader.destroy(asset.publishedStoragePublicId, {
        resource_type: "image",
        type: "upload",
        invalidate: true,
      });
    }
    await recordImageAudit({
      companyId: asset.companyId,
      imageId: asset._id,
      eventType: "image.temporary_expired",
      source: asset.source,
      provider: asset.provider,
      fileSize: asset.bytes,
    });
  }
  return temporary.length;
};

export const purgeExpiredDeletedImages = async ({ now = new Date(), limit = 100 } = {}) => {
  configureCloudinary();
  const assets = await ContentStudioImageAsset.find({
    status: "deleted",
    purgeAfter: { $lte: now },
    referenceCount: 0,
  }).sort({ purgeAfter: 1 }).limit(limit);

  let purged = 0;
  for (const asset of assets) {
    await cloudinary.uploader.destroy(asset.storagePublicId, {
      resource_type: "image",
      type: asset.deliveryType || "upload",
    });
    await recordImageAudit({
      companyId: asset.companyId,
      imageId: asset._id,
      eventType: "image.purged",
      source: asset.source,
      provider: asset.provider,
      fileSize: asset.bytes,
    });
    await asset.deleteOne();
    purged += 1;
  }
  return purged;
};

export const reconcileImageStorage = async ({ apply = false, now = new Date() } = {}) => {
  const [cloudResources, databaseAssets] = await Promise.all([
    listCloudinaryResources(),
    ContentStudioImageAsset.find({ status: { $ne: "deleted" } }).lean(),
  ]);
  const cloudIds = new Set(cloudResources.map((item) => item.public_id));
  const databaseIds = new Set(databaseAssets.flatMap((item) =>
    [item.storagePublicId, item.publishedStoragePublicId].filter(Boolean),
  ));
  const orphanCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const orphanedCloud = cloudResources.filter((item) =>
    !databaseIds.has(item.public_id) && new Date(item.created_at) <= orphanCutoff,
  );
  const missingCloud = databaseAssets.filter((item) => !cloudIds.has(item.storagePublicId));
  const missingPublishedCloud = databaseAssets.filter((item) =>
    item.publishedStoragePublicId && !cloudIds.has(item.publishedStoragePublicId),
  );

  if (apply) {
    for (const resource of orphanedCloud) {
      await cloudinary.uploader.destroy(resource.public_id, {
        resource_type: "image",
        type: resource.deliveryType || "upload",
      });
    }
    for (const asset of missingPublishedCloud) {
      await ContentStudioImageAsset.updateOne({ _id: asset._id }, {
        $set: {
          visibility: "workspace-only",
          publishedUrl: "",
          publishedStoragePublicId: "",
          publishedBytes: 0,
          publishedAt: null,
          publishedByUserId: null,
        },
      });
      await releaseStoredImageUsage({
        companyId: asset.companyId,
        storageBytes: asset.publishedBytes,
        imageCount: 0,
      });
    }
    for (const asset of missingCloud) {
      await ContentStudioImageAsset.updateOne({ _id: asset._id }, {
        $set: { status: "deleted", deletedAt: now, purgeAfter: now },
      });
      await releaseStoredImageUsage({ companyId: asset.companyId, storageBytes: asset.bytes });
      await recordImageAudit({
        companyId: asset.companyId,
        imageId: asset._id,
        eventType: "image.storage_missing",
        source: asset.source,
        provider: asset.provider,
        fileSize: asset.bytes,
      });
    }
  }

  return {
    mode: apply ? "apply" : "audit",
    cloudResources: cloudResources.length,
    databaseAssets: databaseAssets.length,
    orphanedCloud: orphanedCloud.map((item) => item.public_id),
    missingCloud: missingCloud.map((item) => String(item._id)),
    missingPublishedCloud: missingPublishedCloud.map((item) => String(item._id)),
  };
};
