import mongoose from "mongoose";

import Company from "../models/company.js";
import CompanyLifecycleAudit from "../models/companyLifecycleAudit.js";
import Organization from "../models/organization.js";
import { resolveEffectiveBilling } from "./companyAppAccessService.js";
import { databaseSupportsTransactions } from "./organizationService.js";
import { isDistributorOrganization } from "../utils/organizationTypes.js";
import { isCompanyArchived } from "../utils/companyLifecycle.js";

const ORGANIZATION_ADMIN_ROLES = new Set(["owner", "admin"]);
const PLATFORM_ADMIN_ROLES = new Set(["platform-owner", "platform-admin"]);
const MAX_REASON_LENGTH = 500;

const lifecycleError = (statusCode, code, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const normalizeReason = (reason, required) => {
  const normalized = String(reason || "").trim();
  if (required && !normalized) {
    throw lifecycleError(400, "COMPANY_LIFECYCLE_REASON_REQUIRED", "A reason is required.");
  }
  if (normalized.length > MAX_REASON_LENGTH) {
    throw lifecycleError(400, "COMPANY_LIFECYCLE_REASON_TOO_LONG", "The lifecycle reason is too long.");
  }
  return normalized;
};

const actorRole = ({ actor, actorMembership }) =>
  actor?.platformRole || actorMembership?.role || "unknown";

const lifecycleSnapshot = (company) => ({
  lifecycleStatus: isCompanyArchived(company) ? "archived" : "active",
  isActive: company?.isActive !== false,
  archivedAt: company?.archivedAt || null,
  archivedByUserId: company?.archivedByUserId || null,
  archiveReason: company?.archiveReason || "",
  organizationId: company?.organizationId || null,
  billingSource: company?.billingSource || "company",
  reservationBusinessId: company?.reservationBusinessId || null,
  reservationBusinessSlug: company?.reservationBusinessSlug || "",
  reservationTemplate: company?.reservationTemplate,
});

const assertLifecycleAuthorization = ({ company, organization, actor, actorMembership }) => {
  if (PLATFORM_ADMIN_ROLES.has(actor?.platformRole)) return;

  if (
    !organization ||
    !isDistributorOrganization(organization) ||
    !ORGANIZATION_ADMIN_ROLES.has(actorMembership?.role) ||
    actorMembership.status !== "active" ||
    !company.organizationId ||
    String(company.organizationId) !== String(organization._id)
  ) {
    throw lifecycleError(
      403,
      "COMPANY_LIFECYCLE_ACCESS_DENIED",
      "A Distributor Organization owner or administrator for this Company is required.",
    );
  }
};

const restoreCompanyFields = (company, snapshot) => {
  company.lifecycleStatus = snapshot.lifecycleStatus;
  company.isActive = snapshot.isActive;
  company.archivedAt = snapshot.archivedAt;
  company.archivedByUserId = snapshot.archivedByUserId;
  company.archiveReason = snapshot.archiveReason;
};

const persistLifecycleChange = async ({
  company,
  eventType,
  actor,
  actorMembership,
  reason,
  before,
  mutate,
  transactionSupported = databaseSupportsTransactions(),
}) => {
  const afterPreview = { ...before };
  mutate(company);
  Object.assign(afterPreview, lifecycleSnapshot(company));
  const audit = {
    eventType,
    companyId: company._id,
    sourceOrganizationId: before.organizationId,
    targetOrganizationId: company.organizationId || null,
    actorUserId: actor?._id || actorMembership?.userId,
    actorRole: actorRole({ actor, actorMembership }),
    reason,
    before,
    after: afterPreview,
    outcome: "succeeded",
  };

  if (transactionSupported) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await company.save({ session });
        await CompanyLifecycleAudit.create([audit], { session });
      });
    } finally {
      await session.endSession();
    }
    return company;
  }

  await company.save();
  try {
    await CompanyLifecycleAudit.create(audit);
  } catch (error) {
    restoreCompanyFields(company, before);
    try {
      await company.save();
    } catch (compensationError) {
      const consistencyFailure = lifecycleError(
        500,
        "COMPANY_LIFECYCLE_CONSISTENCY_FAILURE",
        "The Company lifecycle change may have partially applied and requires review.",
      );
      consistencyFailure.details = {
        lifecycleMutationMayHavePartiallyApplied: true,
        auditPersistenceFailed: true,
        compensationFailed: true,
      };
      consistencyFailure.cause = compensationError;
      throw consistencyFailure;
    }

    const auditFailure = lifecycleError(
      500,
      "COMPANY_LIFECYCLE_AUDIT_FAILED",
      "The Company lifecycle change could not be audited safely.",
    );
    auditFailure.cause = error;
    throw auditFailure;
  }
  return company;
};

const getCompanyOrThrow = async (companyId) => {
  const company = await Company.findById(companyId);
  if (!company) throw lifecycleError(404, "COMPANY_NOT_FOUND", "Company not found.");
  if (company.isPlatformWorkspace) {
    throw lifecycleError(409, "PLATFORM_WORKSPACE_PROTECTED", "The Platform Workspace cannot be archived.");
  }
  return company;
};

const assertAttachedOrganization = async (company) => {
  if (!company.organizationId) return null;
  const organization = await Organization.findById(company.organizationId);
  if (!organization || organization.status !== "active" || organization.isActive === false) {
    throw lifecycleError(
      409,
      "COMPANY_ORGANIZATION_INVALID",
      "The Company cannot be restored because its Organization is not active.",
    );
  }
  return organization;
};

const assertBillingIsValid = async (company) => {
  const effectiveBilling = await resolveEffectiveBilling(company);
  if (!effectiveBilling.valid) {
    throw lifecycleError(
      409,
      "COMPANY_BILLING_INVALID",
      effectiveBilling.issue || "The Company billing context is not valid for restore.",
    );
  }
};

export const archiveCompany = async ({
  companyId,
  actor = null,
  organization = null,
  actorMembership = null,
  reason,
  transactionSupported,
}) => {
  const company = await getCompanyOrThrow(companyId);
  assertLifecycleAuthorization({ company, organization, actor, actorMembership });
  const normalizedReason = normalizeReason(reason, true);

  if (isCompanyArchived(company)) {
    return { company, alreadyArchived: true };
  }

  const before = lifecycleSnapshot(company);
  await persistLifecycleChange({
    company,
    eventType: "company_archived",
    actor,
    actorMembership,
    reason: normalizedReason,
    before,
    transactionSupported,
    mutate: (document) => {
      document.lifecycleStatus = "archived";
      document.isActive = false;
      document.archivedAt = new Date();
      document.archivedByUserId = actor?._id || actorMembership?.userId || null;
      document.archiveReason = normalizedReason;
    },
  });

  return { company, alreadyArchived: false };
};

export const restoreCompany = async ({
  companyId,
  actor = null,
  organization = null,
  actorMembership = null,
  reason,
  transactionSupported,
}) => {
  const company = await getCompanyOrThrow(companyId);
  assertLifecycleAuthorization({ company, organization, actor, actorMembership });

  if (!isCompanyArchived(company)) {
    return { company, alreadyActive: true };
  }

  await assertAttachedOrganization(company);
  await assertBillingIsValid(company);

  const before = lifecycleSnapshot(company);
  await persistLifecycleChange({
    company,
    eventType: "company_restored",
    actor,
    actorMembership,
    reason: normalizeReason(reason, false),
    before,
    transactionSupported,
    mutate: (document) => {
      document.lifecycleStatus = "active";
      document.isActive = true;
      document.archivedAt = null;
      document.archivedByUserId = null;
      document.archiveReason = "";
    },
  });

  return { company, alreadyActive: false };
};
