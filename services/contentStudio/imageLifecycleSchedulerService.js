import {
  expireTemporaryImages,
  purgeExpiredDeletedImages,
  reconcileImageStorage,
} from "./imageLifecycleService.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const runDailyCleanup = async () => {
  try {
    const expiredTemporary = await expireTemporaryImages();
    const purgedDeleted = await purgeExpiredDeletedImages();
    console.log("Content Studio image lifecycle cleanup", { expiredTemporary, purgedDeleted });
  } catch (error) {
    console.error("Content Studio image lifecycle cleanup failed", {
      code: error?.code || "IMAGE_LIFECYCLE_FAILED",
      message: error?.message,
    });
  }
};

const runWeeklyAudit = async () => {
  try {
    const report = await reconcileImageStorage({ apply: false });
    console.log("Content Studio image storage audit", {
      cloudResources: report.cloudResources,
      databaseAssets: report.databaseAssets,
      orphanedCloud: report.orphanedCloud.length,
      missingCloud: report.missingCloud.length,
    });
  } catch (error) {
    console.error("Content Studio image storage audit failed", {
      code: error?.code || "IMAGE_STORAGE_AUDIT_FAILED",
      message: error?.message,
    });
  }
};

export const startContentStudioImageLifecycleScheduler = () => {
  const initialCleanup = setTimeout(runDailyCleanup, 10 * 60 * 1000);
  const daily = setInterval(runDailyCleanup, DAY_MS);
  const weekly = setInterval(runWeeklyAudit, WEEK_MS);
  initialCleanup.unref?.();
  daily.unref?.();
  weekly.unref?.();
  return { initialCleanup, daily, weekly };
};
