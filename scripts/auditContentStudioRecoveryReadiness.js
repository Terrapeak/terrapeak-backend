import "dotenv/config";
import mongoose from "mongoose";
import ContentStudioContent from "../models/contentStudioContent.js";
import ContentStudioImageAsset from "../models/contentStudioImageAsset.js";
import ContentStudioUsageLedger from "../models/contentStudioUsageLedger.js";
import ContentStudioUsageSummary from "../models/contentStudioUsageSummary.js";

const requiredEvidence = [
  "MONGO_BACKUP_VERIFIED_AT",
  "CLOUDINARY_BACKUP_VERIFIED_AT",
  "CONTENT_STUDIO_RESTORE_DRILL_VERIFIED_AT",
];

if (!process.env.MONGO_URI) {
  throw new Error("MONGO_URI is required.");
}

await mongoose.connect(process.env.MONGO_URI);
try {
  const [content, publishedContent, images, publishedImages, ledgers, summaries] = await Promise.all([
    ContentStudioContent.countDocuments(),
    ContentStudioContent.countDocuments({ publishedAt: { $ne: null } }),
    ContentStudioImageAsset.countDocuments({ status: { $ne: "deleted" } }),
    ContentStudioImageAsset.countDocuments({ publishedStoragePublicId: { $nin: ["", null] } }),
    ContentStudioUsageLedger.countDocuments(),
    ContentStudioUsageSummary.countDocuments(),
  ]);
  const evidence = Object.fromEntries(requiredEvidence.map((name) => [name, process.env[name] || null]));
  const missingEvidence = requiredEvidence.filter((name) => !evidence[name]);
  console.log(JSON.stringify({
    mode: "read-only",
    checkedAt: new Date().toISOString(),
    counts: { content, publishedContent, images, publishedImages, ledgers, summaries },
    evidence,
    ready: missingEvidence.length === 0,
    missingEvidence,
    note: "Evidence variables record completed provider backup checks and an isolated restore drill; this command does not create backups.",
  }, null, 2));
  if (missingEvidence.length) process.exitCode = 2;
} finally {
  await mongoose.disconnect();
}
