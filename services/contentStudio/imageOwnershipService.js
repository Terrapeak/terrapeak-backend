import mongoose from "mongoose";
import ContentStudioImageAsset from "../../models/contentStudioImageAsset.js";
import { recordImageAudit } from "./imageAuditService.js";

const imageNotFound = () => {
  const error = new Error("Image asset not found.");
  error.statusCode = 404;
  error.code = "IMAGE_NOT_FOUND";
  return error;
};

export const findCompanyImageOrThrow = async ({
  companyId,
  assetId,
  userId = null,
  action = "access",
  includeDeleted = false,
  session,
}) => {
  if (
    !mongoose.Types.ObjectId.isValid(companyId) ||
    !mongoose.Types.ObjectId.isValid(assetId)
  ) {
    throw imageNotFound();
  }

  const query = {
    _id: assetId,
    companyId,
    ...(includeDeleted ? {} : { status: { $ne: "deleted" } }),
  };
  let companyAssetQuery = ContentStudioImageAsset.findOne(query);
  if (session) companyAssetQuery = companyAssetQuery.session(session);
  const asset = await companyAssetQuery;

  if (asset) return asset;

  let existenceQuery = ContentStudioImageAsset.findById(assetId)
    .select("_id companyId status");
  if (session) existenceQuery = existenceQuery.session(session);
  const existing = await existenceQuery.lean();

  if (existing && String(existing.companyId) !== String(companyId)) {
    await recordImageAudit({
      companyId,
      userId,
      imageId: existing._id,
      eventType: "image.access_denied",
      secureMetadata: {
        action,
        owningCompanyId: String(existing.companyId),
        requestedCompanyId: String(companyId),
      },
      session,
    });
  }

  // Deliberately return the same response for missing, deleted, and
  // cross-company assets. Ownership details stay in secure audit records.
  throw imageNotFound();
};

export const validateCompanyImages = async ({
  companyId,
  userId,
  assetIds,
  action = "attach",
  session,
}) => {
  const uniqueIds = [...new Set((assetIds || []).map(String))];
  return Promise.all(
    uniqueIds.map((assetId) =>
      findCompanyImageOrThrow({
        companyId,
        assetId,
        userId,
        action,
        session,
      }),
    ),
  );
};
