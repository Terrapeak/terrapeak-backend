import test from "node:test";
import assert from "node:assert/strict";
import { CONTENT_STUDIO_PLAN_LIMITS, getContentStudioPlanLimits } from "../services/contentStudio/contentStudioEntitlementService.js";

test("Content Studio plan limits increase by tier", () => {
  const { starter, growth, professional, enterprise } = CONTENT_STUDIO_PLAN_LIMITS;
  assert.ok(starter.storedImages < growth.storedImages);
  assert.ok(growth.storageBytes < professional.storageBytes);
  assert.ok(professional.generatedImagesPerMonth < enterprise.generatedImagesPerMonth);
});

test("unknown plans safely receive Starter limits", () => {
  assert.deepEqual(getContentStudioPlanLimits("unknown"), CONTENT_STUDIO_PLAN_LIMITS.starter);
});
