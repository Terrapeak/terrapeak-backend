import express from "express";
import isVerifiedUser from "../middleware/isVerifiedUser.js";
import resolveCompanyContext from "../middleware/resolveCompanyContext.js";
import requireCompanyWriteAccess from "../middleware/requireCompanyWriteAccess.js";
import requireCompanyApp from "../middleware/requireCompanyApp.js";
import requireDigitalCloneMediaConsent from "../middleware/requireDigitalCloneMediaConsent.js";
import requireDigitalCloneVoiceConsent from "../middleware/requireDigitalCloneVoiceConsent.js";
import { digitalCloneGenerationRateLimit } from "../middleware/digitalCloneGenerationRateLimit.js";
import {
  digitalCloneImageRateLimit,
  digitalCloneImageUpload,
} from "../middleware/digitalCloneImageUpload.js";
import { digitalCloneVoiceUpload } from "../middleware/digitalCloneVoiceUpload.js";
import {
  digitalCloneVoiceCreationRateLimit,
  digitalCloneVoicePreviewRateLimit,
  digitalCloneVoiceUploadConcurrencyLimit,
  digitalCloneVoiceUploadRateLimit,
} from "../middleware/digitalCloneVoiceRateLimit.js";
import {
  acceptDigitalCloneConsent,
  approveDigitalCloneGeneration,
  archiveDigitalCloneGeneration,
  deleteDigitalCloneIdentityImage,
  deliverDigitalCloneIdentityImage,
  getDigitalBrainProfile,
  getDigitalBrainReadiness,
  generateDigitalCloneContent,
  getDigitalCloneGeneration,
  getDigitalCloneProfile,
  listDigitalCloneIdentityImages,
  listDigitalCloneGenerations,
  rejectDigitalCloneGeneration,
  revokeDigitalCloneIdentityImage,
  saveDigitalBrainProfile,
  saveDigitalCloneProfile,
  updateDigitalCloneIdentityImage,
  updateDigitalCloneGeneration,
  uploadDigitalCloneIdentityImages,
} from "../controllers/digitalCloneController.js";
import {
  acceptDigitalCloneVoiceConsent,
  approveDigitalCloneVoice,
  createDigitalCloneVoice,
  deleteDigitalCloneVoiceSample,
  deliverDigitalCloneVoicePreview,
  deliverDigitalCloneVoiceSample,
  generateDigitalCloneVoicePreview,
  getDigitalCloneVoice,
  listDigitalCloneVoiceSamples,
  revokeDigitalCloneVoice,
  updateDigitalCloneVoiceSettings,
  uploadDigitalCloneVoiceSamples,
} from "../controllers/digitalCloneVoiceController.js";

const router = express.Router();

router.use(
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  requireCompanyApp("digital-clone"),
);

router.get("/profile", getDigitalCloneProfile);
router.put("/profile", saveDigitalCloneProfile);
router.post("/consent", acceptDigitalCloneConsent);
router.get("/brain", getDigitalBrainProfile);
router.put("/brain", saveDigitalBrainProfile);
router.patch("/brain", saveDigitalBrainProfile);
router.get("/brain/readiness", getDigitalBrainReadiness);

router.get("/voice", getDigitalCloneVoice);
router.post("/voice/consent", acceptDigitalCloneVoiceConsent);
router.get("/voice/samples", requireDigitalCloneVoiceConsent, listDigitalCloneVoiceSamples);
router.post(
  "/voice/samples/upload",
  requireDigitalCloneVoiceConsent,
  digitalCloneVoiceUploadRateLimit,
  digitalCloneVoiceUploadConcurrencyLimit,
  digitalCloneVoiceUpload,
  uploadDigitalCloneVoiceSamples,
);
router.get(
  "/voice/samples/:sampleId/delivery",
  requireDigitalCloneVoiceConsent,
  deliverDigitalCloneVoiceSample,
);
router.delete("/voice/samples/:sampleId", requireDigitalCloneVoiceConsent, deleteDigitalCloneVoiceSample);
router.patch("/voice/settings", requireDigitalCloneVoiceConsent, updateDigitalCloneVoiceSettings);
router.post(
  "/voice/create",
  requireDigitalCloneVoiceConsent,
  digitalCloneVoiceCreationRateLimit,
  createDigitalCloneVoice,
);
router.post(
  "/voice/previews",
  requireDigitalCloneVoiceConsent,
  digitalCloneVoicePreviewRateLimit,
  generateDigitalCloneVoicePreview,
);
router.get(
  "/voice/previews/:previewId/delivery",
  requireDigitalCloneVoiceConsent,
  deliverDigitalCloneVoicePreview,
);
router.post(
  "/voice/previews/:previewId/approve",
  requireDigitalCloneVoiceConsent,
  approveDigitalCloneVoice,
);
router.post("/voice/revoke", revokeDigitalCloneVoice);

router.post("/generate", digitalCloneGenerationRateLimit, generateDigitalCloneContent);
router.get("/drafts", listDigitalCloneGenerations);
router.get("/drafts/:draftId", getDigitalCloneGeneration);
router.patch("/drafts/:draftId", updateDigitalCloneGeneration);
router.post("/drafts/:draftId/approve", approveDigitalCloneGeneration);
router.post("/drafts/:draftId/reject", rejectDigitalCloneGeneration);
router.post("/drafts/:draftId/archive", archiveDigitalCloneGeneration);

router.use("/visual-identity", requireDigitalCloneMediaConsent);
router.get("/visual-identity", listDigitalCloneIdentityImages);
router.post(
  "/visual-identity/upload",
  digitalCloneImageRateLimit,
  digitalCloneImageUpload,
  uploadDigitalCloneIdentityImages,
);
router.get("/visual-identity/:assetId/delivery", deliverDigitalCloneIdentityImage);
router.patch("/visual-identity/:assetId", updateDigitalCloneIdentityImage);
router.post("/visual-identity/:assetId/revoke", revokeDigitalCloneIdentityImage);
router.delete("/visual-identity/:assetId", deleteDigitalCloneIdentityImage);

router.use((error, req, res, next) => {
  const status = Number(error?.statusCode || 0);
  if (!Number.isInteger(status) || status < 400 || status >= 600) return next(error);
  const code = String(error.code || "DIGITAL_CLONE_REQUEST_FAILED");
  const safeServerMessage = new Set([
    "AI_TIMEOUT", "AI_PROVIDER_UNAVAILABLE", "AI_PROVIDER_AUTHENTICATION_FAILED",
    "INVALID_GENERATED_CONTENT", "GENERATED_CONTENT_GUARDRAIL_FAILED",
  ]).has(code);
  return res.status(status).json({
    success: false,
    code,
    message: status >= 500 && !safeServerMessage ? "Digital Clone could not complete the request." : error.message,
    ...(error.code === "DIGITAL_BRAIN_NOT_READY" && error.details ? { completion: error.details } : {}),
  });
});

export default router;
