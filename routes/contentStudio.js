import express from "express";
import isVerifiedUser from "../middleware/isVerifiedUser.js";
import resolveCompanyContext from "../middleware/resolveCompanyContext.js";
import requireCompanyWriteAccess from "../middleware/requireCompanyWriteAccess.js";
import requireCompanyApp from "../middleware/requireCompanyApp.js";
import { contentStudioImageUpload } from "../middleware/contentStudioImageUpload.js";
import { generateContentDraft } from "../controllers/contentStudioController.js";
import {
  deleteContentController,
  getContentByIdController,
  getContentLibraryController,
  saveContentController,
  updateContentController,
} from "../controllers/contentStudioLibraryController.js";
import {
  getBrandSettingsController,
  saveBrandSettingsController,
} from "../controllers/contentStudioBrandSettingsController.js";
import { getCompanyContentStudioUsage } from "../controllers/contentStudioUsageController.js";
import {
  deleteImageController,
  generateImagesController,
  importDriveImageController,
  importImageUrlController,
  listDriveImagesController,
  listImagesController,
  uploadImagesController,
} from "../controllers/contentStudioImageController.js";

const router = express.Router();

router.use(
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  requireCompanyApp("content-studio"),
);

router.post("/generate", generateContentDraft);
router.post("/save", saveContentController);
router.get("/library", getContentLibraryController);
router.get("/brand-settings", getBrandSettingsController);
router.put("/brand-settings", saveBrandSettingsController);

router.get("/usage", getCompanyContentStudioUsage);
router.get("/images", listImagesController);
router.post("/images/upload", contentStudioImageUpload, uploadImagesController);
router.post("/images/import-url", importImageUrlController);
router.get("/images/google-drive", listDriveImagesController);
router.post("/images/google-drive/import", importDriveImageController);
router.post("/images/generate", generateImagesController);
router.delete("/images/:assetId", deleteImageController);

router.get("/:id", getContentByIdController);
router.patch("/:id", updateContentController);
router.delete("/:id", deleteContentController);

export default router;
