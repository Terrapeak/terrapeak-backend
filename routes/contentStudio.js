import express from "express";
import isVerifiedUser from "../middleware/isAuthenticated.js";
import resolveCompanyContext from "../middleware/resolveCompanyContext.js";
import requireCompanyWriteAccess from "../middleware/requireCompanyWriteAccess.js";
import requireCompanyApp from "../middleware/requireCompanyApp.js";
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

router.get("/:id", getContentByIdController);

router.patch("/:id", updateContentController);

router.delete("/:id", deleteContentController);

export default router;
