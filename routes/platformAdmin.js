import express from "express";

import isAuthenticated from "../middleware/isAuthenticated.js";
import isPlatformAdmin from "../middleware/isPlatformAdmin.js";

import {
  searchPlatformCompanies,
  getPlatformCompanyDetail,
  toggleCompanyApp,
  getPlatformApps,
  updatePlatformApp,
} from "../controllers/platformAdminController.js";
import {
  getPlatformDashboardSummary,
  runPlatformAttentionScanNow,
} from "../controllers/platformAttentionController.js";
import { listPlatformCompanies } from "../controllers/platformCompanyListController.js";
import { listPlatformUsers } from "../controllers/platformUserController.js";
import {
  getPlatformOnboardingOptions,
  onboardPlatformCustomer,
} from "../controllers/platformOnboardingController.js";

const router = express.Router();

router.get("/summary", isAuthenticated, isPlatformAdmin, getPlatformDashboardSummary);
router.post("/attention-scan", isAuthenticated, isPlatformAdmin, runPlatformAttentionScanNow);
router.get("/companies", isAuthenticated, isPlatformAdmin, listPlatformCompanies);
router.get("/users", isAuthenticated, isPlatformAdmin, listPlatformUsers);
router.get("/onboarding/options", isAuthenticated, isPlatformAdmin, getPlatformOnboardingOptions);
router.post("/onboarding", isAuthenticated, isPlatformAdmin, onboardPlatformCustomer);
router.get("/companies/search", isAuthenticated, isPlatformAdmin, searchPlatformCompanies);
router.get("/companies/:companyId", isAuthenticated, isPlatformAdmin, getPlatformCompanyDetail);
router.post("/companies/:companyId/apps/:appId/toggle", isAuthenticated, isPlatformAdmin, toggleCompanyApp);
router.get("/apps", isAuthenticated, isPlatformAdmin, getPlatformApps);
router.put("/apps/:appId", isAuthenticated, isPlatformAdmin, updatePlatformApp);

export default router;
