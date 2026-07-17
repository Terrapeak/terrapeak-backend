import express from "express";

import isPlatformAuthenticated from "../middleware/isPlatformAuthenticated.js";
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

router.get("/summary", isPlatformAuthenticated, isPlatformAdmin, getPlatformDashboardSummary);
router.post("/attention-scan", isPlatformAuthenticated, isPlatformAdmin, runPlatformAttentionScanNow);
router.get("/companies", isPlatformAuthenticated, isPlatformAdmin, listPlatformCompanies);
router.get("/users", isPlatformAuthenticated, isPlatformAdmin, listPlatformUsers);
router.get("/onboarding/options", isPlatformAuthenticated, isPlatformAdmin, getPlatformOnboardingOptions);
router.post("/onboarding", isPlatformAuthenticated, isPlatformAdmin, onboardPlatformCustomer);
router.get("/companies/search", isPlatformAuthenticated, isPlatformAdmin, searchPlatformCompanies);
router.get("/companies/:companyId", isPlatformAuthenticated, isPlatformAdmin, getPlatformCompanyDetail);
router.patch("/companies/:companyId", isPlatformAuthenticated, isPlatformAdmin, updatePlatformCompany);
router.patch("/companies/:companyId/commercial", isPlatformAuthenticated, isPlatformAdmin, updatePlatformCommercialSettings);
router.get("/companies/:companyId/ai-config", isPlatformAuthenticated, isPlatformAdmin, getPlatformAIConfig);
router.patch("/companies/:companyId/ai-config", isPlatformAuthenticated, isPlatformAdmin, updatePlatformAIConfig);
router.post("/companies/:companyId/ai-config/test", isPlatformAuthenticated, isPlatformAdmin, testPlatformAIConfig);
router.post("/companies/:companyId/users", isPlatformAuthenticated, isPlatformAdmin, addPlatformCompanyUser);
router.post("/companies/:companyId/users/invite", isPlatformAuthenticated, isPlatformAdmin, invitePlatformCompanyUser);
router.patch("/companies/:companyId/users/:membershipId", isPlatformAuthenticated, isPlatformAdmin, updatePlatformCompanyUser);
router.delete("/companies/:companyId/users/:membershipId", isPlatformAuthenticated, isPlatformAdmin, removePlatformCompanyUser);
router.post("/companies/:companyId/users/:membershipId/resend-invitation", isPlatformAuthenticated, isPlatformAdmin, resendPlatformCompanyInvitation);
router.post("/companies/:companyId/users/:membershipId/password-reset", isPlatformAuthenticated, isPlatformAdmin, sendPlatformUserPasswordReset);
router.post("/companies/:companyId/apps/:appId/toggle", isPlatformAuthenticated, isPlatformAdmin, toggleCompanyApp);
router.get("/apps", isPlatformAuthenticated, isPlatformAdmin, getPlatformApps);
router.put("/apps/:appId", isPlatformAuthenticated, isPlatformAdmin, updatePlatformApp);

export default router;
