import crypto from "node:crypto";
import mongoose from "mongoose";
import Company from "../../models/company.js";
import ContentStudioUsageLedger from "../../models/contentStudioUsageLedger.js";
import ContentStudioUsageSummary from "../../models/contentStudioUsageSummary.js";
import ContentStudioImageAsset from "../../models/contentStudioImageAsset.js";
import { getContentStudioPlanLimits } from "./contentStudioEntitlementService.js";
import { resolveEffectiveBilling } from "../companyAppAccessService.js";

const monthWindow = (now = new Date()) => ({
  periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
});

const quotaError = (code, message) => {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
};

export const createUsageRequestId = () => crypto.randomUUID();

export const reserveContentStudioUsage = async ({
  companyId,
  requestId,
  action,
  storageBytes = 0,
  imageCount = 1,
  generationCount = 0,
  metadata = {},
}) => {
  const existing = await ContentStudioUsageLedger.findOne({ companyId, requestId, action }).lean();
  if (existing) return existing;

  const company = await Company.findById(companyId)
    .select("plan billingSource billing organizationId")
    .lean();
  if (!company) throw quotaError("COMPANY_NOT_FOUND", "Company not found.");
  const effectiveBilling = await resolveEffectiveBilling(company);
  const limits = getContentStudioPlanLimits(effectiveBilling.plan);
  const session = await mongoose.startSession();
  let reservation;

  try {
    await session.withTransaction(async () => {
      const period = monthWindow();
      await ContentStudioUsageSummary.updateOne(
        { companyId },
        { $setOnInsert: { companyId, ...period } },
        { upsert: true, session },
      );

      await ContentStudioUsageSummary.updateOne(
        { companyId, periodEnd: { $lte: new Date() } },
        {
          $set: { ...period, generatedImagesThisMonth: 0, uploadedImagesThisMonth: 0 },
        },
        { session },
      );

      const summary = await ContentStudioUsageSummary.findOneAndUpdate(
        {
          companyId,
          $expr: {
            $and: [
              { $lte: [{ $add: ["$storageBytes", "$reservedStorageBytes", storageBytes] }, limits.storageBytes] },
              { $lte: [{ $add: ["$imageCount", "$reservedImageCount", imageCount] }, limits.storedImages] },
              { $lte: [{ $add: ["$generatedImagesThisMonth", "$reservedGeneratedImages", generationCount] }, limits.generatedImagesPerMonth] },
            ],
          },
        },
        {
          $inc: {
            reservedStorageBytes: storageBytes,
            reservedImageCount: imageCount,
            reservedGeneratedImages: generationCount,
          },
        },
        { new: true, session },
      );

      if (!summary) {
        const current = await ContentStudioUsageSummary.findOne({ companyId }).session(session).lean();
        if ((current?.storageBytes || 0) + (current?.reservedStorageBytes || 0) + storageBytes > limits.storageBytes) {
          throw quotaError("CONTENT_STUDIO_STORAGE_LIMIT_REACHED", "This company has reached its Content Studio storage allowance.");
        }
        if ((current?.imageCount || 0) + (current?.reservedImageCount || 0) + imageCount > limits.storedImages) {
          throw quotaError("CONTENT_STUDIO_IMAGE_LIMIT_REACHED", "This company has reached its stored image allowance.");
        }
        throw quotaError("IMAGE_GENERATION_LIMIT_REACHED", "This company has reached its monthly image-generation allowance.");
      }

      [reservation] = await ContentStudioUsageLedger.create([{
        companyId, requestId, action, status: "reserved",
        storageBytes, imageCount, generationCount, metadata,
      }], { session });
    });
    return reservation.toObject();
  } catch (error) {
    if (error?.code === 11000) {
      return ContentStudioUsageLedger.findOne({ companyId, requestId, action }).lean();
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

export const commitContentStudioUsage = async ({ companyId, requestId, action, actualStorageBytes }) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const ledger = await ContentStudioUsageLedger.findOne({ companyId, requestId, action }).session(session);
      if (!ledger || ledger.status === "committed") return;
      if (ledger.status !== "reserved") throw quotaError("USAGE_RESERVATION_INVALID", "Usage reservation is not active.");
      const bytes = Math.max(0, Number(actualStorageBytes ?? ledger.storageBytes) || 0);
      await ContentStudioUsageSummary.updateOne({ companyId }, {
        $inc: {
          reservedStorageBytes: -ledger.storageBytes,
          reservedImageCount: -ledger.imageCount,
          reservedGeneratedImages: -ledger.generationCount,
          storageBytes: bytes,
          imageCount: ledger.imageCount,
          generatedImagesThisMonth: ledger.generationCount,
          uploadedImagesThisMonth: ledger.imageCount - ledger.generationCount,
        },
      }, { session });
      ledger.status = "committed";
      ledger.storageBytes = bytes;
      await ledger.save({ session });
    });
  } finally { await session.endSession(); }
};

export const rollbackContentStudioUsage = async ({ companyId, requestId, action, failureCode = "" }) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const ledger = await ContentStudioUsageLedger.findOne({ companyId, requestId, action }).session(session);
      if (!ledger || ledger.status !== "reserved") return;
      await ContentStudioUsageSummary.updateOne({ companyId }, { $inc: {
        reservedStorageBytes: -ledger.storageBytes,
        reservedImageCount: -ledger.imageCount,
        reservedGeneratedImages: -ledger.generationCount,
      } }, { session });
      ledger.status = "rolled-back";
      ledger.failureCode = String(failureCode || "");
      await ledger.save({ session });
    });
  } finally { await session.endSession(); }
};

export const releaseStoredImageUsage = ({ companyId, storageBytes = 0, imageCount = 1 }) =>
  ContentStudioUsageSummary.updateOne(
    { companyId },
    [{
      $set: {
        storageBytes: { $max: [0, { $subtract: ["$storageBytes", Math.max(0, Number(storageBytes) || 0)] }] },
        imageCount: { $max: [0, { $subtract: ["$imageCount", Math.max(0, Number(imageCount) || 0)] }] },
      },
    }],
  );

const percentOf = (used, limit) =>
  limit >= Number.MAX_SAFE_INTEGER ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));

export const getContentStudioUsageSnapshot = async ({ companyId }) => {
  const [company, summary, lastUpload, lastGenerated] = await Promise.all([
    Company.findById(companyId)
      .select("plan name billingSource billing organizationId")
      .lean(),
    ContentStudioUsageSummary.findOne({ companyId }).lean(),
    ContentStudioImageAsset.findOne({ companyId, status: "active" }).sort({ createdAt: -1 }).select("createdAt").lean(),
    ContentStudioImageAsset.findOne({ companyId, status: "active", source: "generated" }).sort({ createdAt: -1 }).select("createdAt").lean(),
  ]);
  if (!company) throw quotaError("COMPANY_NOT_FOUND", "Company not found.");

  const effectiveBilling = await resolveEffectiveBilling(company);
  const limits = getContentStudioPlanLimits(effectiveBilling.plan);
  const usage = {
    storageBytes: Math.max(0, summary?.storageBytes || 0),
    imageCount: Math.max(0, summary?.imageCount || 0),
    generatedImagesThisMonth: Math.max(0, summary?.generatedImagesThisMonth || 0),
    uploadedImagesThisMonth: Math.max(0, summary?.uploadedImagesThisMonth || 0),
  };
  const percentages = {
    storage: percentOf(usage.storageBytes, limits.storageBytes),
    images: percentOf(usage.imageCount, limits.storedImages),
    generations: percentOf(usage.generatedImagesThisMonth, limits.generatedImagesPerMonth),
  };
  const warnings = Object.entries(percentages)
    .filter(([, percent]) => percent >= 80)
    .map(([resource, percent]) => ({
      resource,
      level: percent >= 100 ? "limit" : "warning",
      percent,
      code: percent >= 100 ? "CONTENT_STUDIO_ALLOWANCE_REACHED" : "CONTENT_STUDIO_ALLOWANCE_WARNING",
    }));

  return {
    companyId,
    companyName: company.name,
    plan: effectiveBilling.plan,
    configuredPlan: company.plan,
    billingSource: effectiveBilling.source,
    periodStart: summary?.periodStart || monthWindow().periodStart,
    periodEnd: summary?.periodEnd || monthWindow().periodEnd,
    usage,
    limits,
    percentages,
    warnings,
    lastUploadAt: lastUpload?.createdAt || null,
    lastGeneratedAt: lastGenerated?.createdAt || null,
  };
};
