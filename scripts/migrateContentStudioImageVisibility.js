import "dotenv/config";
import mongoose from "mongoose";
import ContentStudioImageAsset from "../models/contentStudioImageAsset.js";

const mode = process.argv[2] || "audit";
if (!["audit", "apply", "verify"].includes(mode)) throw new Error("Use audit, apply, or verify.");
await mongoose.connect(process.env.MONGO_URI);
try {
  const missingQuery = {
    $or: [
      { visibility: { $exists: false } },
      { deliveryType: { $exists: false } },
    ],
  };
  const before = await ContentStudioImageAsset.countDocuments(missingQuery);
  let updated = 0;
  if (mode === "apply" && before) {
    const result = await ContentStudioImageAsset.updateMany(missingQuery, {
      $set: { visibility: "legacy-public", deliveryType: "upload" },
    });
    updated = result.modifiedCount;
  }
  const remaining = await ContentStudioImageAsset.countDocuments(missingQuery);
  const legacyPublic = await ContentStudioImageAsset.countDocuments({
    visibility: "legacy-public",
    deliveryType: "upload",
  });
  const report = { mode, scanned: await ContentStudioImageAsset.countDocuments(), candidates: before, updated, remaining, legacyPublic };
  if (mode === "verify" && remaining !== 0) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
} finally {
  await mongoose.disconnect();
}
