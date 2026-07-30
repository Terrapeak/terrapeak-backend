import "dotenv/config";
import mongoose from "mongoose";
import {
  expireTemporaryImages,
  purgeExpiredDeletedImages,
  reconcileImageStorage,
} from "../services/contentStudio/imageLifecycleService.js";

const apply = process.argv.includes("--apply");
await mongoose.connect(process.env.MONGO_URI);
try {
  const report = await reconcileImageStorage({ apply });
  if (apply) {
    report.expiredTemporary = await expireTemporaryImages();
    report.purgedDeleted = await purgeExpiredDeletedImages();
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await mongoose.disconnect();
}
