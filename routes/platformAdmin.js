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
  updatePlatformCompany,
  addPlatformCompanyUser,
  updatePlatformCompanyUser,
  removePlatformCompanyUser,
} from "../controllers/platformCompanyEditController.js";
import {
  invitePlatformCompanyUser,
  resendPlatformCompanyInvitation,
  sendPlatformUserPasswordReset,
} from "../controllers/platformUserLifecycleController.js";
import { updatePlatformCommercialSettings } from "../controllers/platformCommercialController.js";
import {
  getPlatformAIConfig,
  updatePlatformAIConfig,
  testPlatformAIConfig,
} from "../controllers/platformAIConfigController.js";
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
router.patch("/companies/:companyId", isAuthenticated, isPlatformAdmin, updatePlatformCompany);
router.patch("/companies/:companyId/commercial", isAuthenticated, isPlatformAdmin, updatePlatformCommercialSettings);
router.get("/companies/:companyId/ai-config", isAuthenticated, isPlatformAdmin, getPlatformAIConfig);
router.patch("/companies/:companyId/ai-config", isAuthenticated, isPlatformAdmin, updatePlatformAIConfig);
router.post("/companies/:companyId/ai-config/test", isAuthenticated, isPlatformAdmin, testPlatformAIConfig);
router.post("/companies/:companyId/users", isAuthenticated, isPlatformAdmin, addPlatformCompanyUser);
router.post("/companies/:companyId/users/invite", isAuthenticated, isPlatformAdmin, invitePlatformCompanyUser);
router.patch("/companies/:companyId/users/:membershipId", isAuthenticated, isPlatformAdmin, updatePlatformCompanyUser);
router.delete("/companies/:companyId/users/:membershipId", isAuthenticated, isPlatformAdmin, removePlatformCompanyUser);
router.post("/companies/:companyId/users/:membershipId/resend-invitation", isAuthenticated, isPlatformAdmin, resendPlatformCompanyInvitation);
router.post("/companies/:companyId/users/:membershipId/password-reset", isAuthenticated, isPlatformAdmin, sendPlatformUserPasswordReset);
router.post("/companies/:companyId/apps/:appId/toggle", isAuthenticated, isPlatformAdmin, toggleCompanyApp);
router.get("/apps", isAuthenticated, isPlatformAdmin, getPlatformApps);
router.put("/apps/:appId", isAuthenticated, isPlatformAdmin, updatePlatformApp);

export default router;
