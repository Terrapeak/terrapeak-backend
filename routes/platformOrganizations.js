import express from "express";

import {
  addPlatformOrganizationOwner,
  attachPlatformOrganizationCompany,
  createPlatformOrganization,
  detachPlatformOrganizationCompany,
  getPlatformOrganization,
  getPlatformOrganizations,
  lookupPlatformOrganizationOwner,
  patchPlatformOrganizationOwner,
  postPlatformOrganizationOwnerPasswordReset,
  patchPlatformOrganization,
} from "../controllers/organizationController.js";
import {
  getPlatformOrganizationBilling,
  updatePlatformOrganizationBilling,
} from "../controllers/platformOrganizationBillingController.js";
import isPlatformAdmin from "../middleware/isPlatformAdmin.js";
import isPlatformAuthenticated from "../middleware/isPlatformAuthenticated.js";

const router = express.Router();

router.use(isPlatformAuthenticated, isPlatformAdmin);

router.post("/", createPlatformOrganization);
router.get("/owner-lookup", lookupPlatformOrganizationOwner);
router.get("/", getPlatformOrganizations);
router.get("/:organizationId", getPlatformOrganization);
router.patch("/:organizationId", patchPlatformOrganization);
router.patch("/:organizationId/owner", patchPlatformOrganizationOwner);
router.post(
  "/:organizationId/owner/password-reset",
  postPlatformOrganizationOwnerPasswordReset,
);
router.get("/:organizationId/billing", getPlatformOrganizationBilling);
router.patch("/:organizationId/billing", updatePlatformOrganizationBilling);
router.post(
  "/:organizationId/initial-owner",
  addPlatformOrganizationOwner,
);
router.post(
  "/:organizationId/companies/:companyId",
  attachPlatformOrganizationCompany,
);
router.delete(
  "/:organizationId/companies/:companyId",
  detachPlatformOrganizationCompany,
);

export default router;
