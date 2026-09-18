import express from "express";

import {
  attachOrganizationCompany,
  archiveOrganizationCompany,
  createOrganizationMember,
  createDistributorOrganizationCompany,
  getDistributorCompanyOptions,
  deleteOrganizationMember,
  detachOrganizationCompany,
  getMyOrganizations,
  getOrganization,
  getOrganizationCompanies,
  getOrganizationMembers,
  patchOrganization,
  patchOrganizationMember,
  restoreOrganizationCompany,
} from "../controllers/organizationController.js";
import isAuthenticated from "../middleware/isAuthenticated.js";
import resolveOrganizationContext, {
  requireOrganizationMembership,
  requireOrganizationRole,
} from "../middleware/resolveOrganizationContext.js";

const router = express.Router();

const organizationContext = [
  resolveOrganizationContext,
  requireOrganizationMembership,
];

router.get("/", isAuthenticated, getMyOrganizations);
router.get(
  "/:organizationId",
  ...organizationContext,
  getOrganization
);
router.patch(
  "/:organizationId",
  ...organizationContext,
  requireOrganizationRole("owner", "admin"),
  patchOrganization
);
router.get(
  "/:organizationId/companies",
  ...organizationContext,
  getOrganizationCompanies
);
router.post(
  "/:organizationId/companies",
  ...organizationContext,
  requireOrganizationRole("owner", "admin"),
  createDistributorOrganizationCompany,
);
router.get(
  "/:organizationId/companies/options",
  ...organizationContext,
  requireOrganizationRole("owner", "admin"),
  getDistributorCompanyOptions,
);
router.post(
  "/:organizationId/companies/:companyId",
  ...organizationContext,
  requireOrganizationRole("owner", "admin"),
  attachOrganizationCompany
);
router.delete(
  "/:organizationId/companies/:companyId",
  ...organizationContext,
  requireOrganizationRole("owner", "admin"),
  detachOrganizationCompany
);
router.post(
  "/:organizationId/companies/:companyId/archive",
  ...organizationContext,
  requireOrganizationRole("owner", "admin"),
  archiveOrganizationCompany,
);
router.post(
  "/:organizationId/companies/:companyId/restore",
  ...organizationContext,
  requireOrganizationRole("owner", "admin"),
  restoreOrganizationCompany,
);
router.get(
  "/:organizationId/members",
  ...organizationContext,
  requireOrganizationRole("owner", "admin", "manager"),
  getOrganizationMembers
);
router.post(
  "/:organizationId/members",
  ...organizationContext,
  requireOrganizationRole("owner", "admin"),
  createOrganizationMember
);
router.patch(
  "/:organizationId/members/:membershipId",
  ...organizationContext,
  requireOrganizationRole("owner", "admin"),
  patchOrganizationMember
);
router.delete(
  "/:organizationId/members/:membershipId",
  ...organizationContext,
  requireOrganizationRole("owner", "admin"),
  deleteOrganizationMember
);

export default router;
