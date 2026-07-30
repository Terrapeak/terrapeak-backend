export const CONTENT_STUDIO_PLAN_LIMITS = Object.freeze({
  starter: { storedImages: 100, storageBytes: 500 * 1024 * 1024, generatedImagesPerMonth: 20 },
  growth: { storedImages: 500, storageBytes: 2 * 1024 * 1024 * 1024, generatedImagesPerMonth: 100 },
  professional: { storedImages: 2000, storageBytes: 10 * 1024 * 1024 * 1024, generatedImagesPerMonth: 500 },
  enterprise: { storedImages: Number.MAX_SAFE_INTEGER, storageBytes: Number.MAX_SAFE_INTEGER, generatedImagesPerMonth: Number.MAX_SAFE_INTEGER },
});

export const getContentStudioPlanLimits = (plan) =>
  CONTENT_STUDIO_PLAN_LIMITS[String(plan || "starter").toLowerCase()] ||
  CONTENT_STUDIO_PLAN_LIMITS.starter;
