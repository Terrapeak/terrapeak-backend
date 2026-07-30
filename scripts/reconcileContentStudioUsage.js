import "dotenv/config";
import mongoose from "mongoose";
import ContentStudioImageAsset from "../models/contentStudioImageAsset.js";
import ContentStudioUsageSummary from "../models/contentStudioUsageSummary.js";

const apply = process.argv.includes("--apply");
const now = new Date();
const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

await mongoose.connect(process.env.MONGO_URI);
try {
  const usage = await ContentStudioImageAsset.aggregate([
    { $match: { status: { $ne: "deleted" } } },
    { $group: {
      _id: "$companyId",
      storageBytes: { $sum: { $ifNull: ["$bytes", 0] } },
      imageCount: { $sum: 1 },
      generatedImagesThisMonth: { $sum: {
        $cond: [
          { $and: [
            { $eq: ["$source", "generated"] },
            { $gte: ["$createdAt", periodStart] },
            { $lt: ["$createdAt", periodEnd] },
          ] },
          1, 0,
        ],
      } },
      uploadedImagesThisMonth: { $sum: {
        $cond: [
          { $and: [
            { $ne: ["$source", "generated"] },
            { $gte: ["$createdAt", periodStart] },
            { $lt: ["$createdAt", periodEnd] },
          ] },
          1, 0,
        ],
      } },
    } },
  ]);

  const report = { mode: apply ? "apply" : "audit", companies: usage.length, updated: 0, usage };
  if (apply) {
    for (const row of usage) {
      await ContentStudioUsageSummary.updateOne(
        { companyId: row._id },
        { $set: {
          storageBytes: row.storageBytes,
          imageCount: row.imageCount,
          generatedImagesThisMonth: row.generatedImagesThisMonth,
          uploadedImagesThisMonth: row.uploadedImagesThisMonth,
          reservedStorageBytes: 0,
          reservedImageCount: 0,
          reservedGeneratedImages: 0,
          periodStart,
          periodEnd,
        } },
        { upsert: true },
      );
      report.updated += 1;
    }
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await mongoose.disconnect();
}
