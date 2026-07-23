import express from "express";

import {
  addPlatformOrganizationOwner,
  attachPlatformOrganizationCompany,
  createPlatformOrganization,
  detachPlatformOrganizationCompany,
  getPlatformOrganization,
  getPlatformOrganizations,
  patchPlatformOrganization,
} from "../controllers/organizationController.js";
import isPlatformAdmin from "../middleware/isPlatformAdmin.js";
import isPlatformAuthenticated from "../middleware/isPlatformAuthenticated.js";

const router = express.Router();

router.use(isPlatformAuthenticated, isPlatformAdmin);

router.post("/", createPlatformOrganization);
router.get("/", getPlatformOrganizations);
router.get("/:organizationId", getPlatformOrganization);
router.patch("/:organizationId", patchPlatformOrganization);
router.post(
  "/:organizationId/initial-owner",
  addPlatformOrganizationOwner
);
router.post(
  "/:organizationId/companies/:companyId",
  attachPlatformOrganizationCompany
);
router.delete(
  "/:organizationId/companies/:companyId",
  detachPlatformOrganizationCompany
);

export default router;
