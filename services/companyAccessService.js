import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import { isDistributorOrganization } from "../utils/organizationTypes.js";

export const COMPANY_ACCESS_SOURCES = Object.freeze({
  DIRECT: "direct_company_membership",
  DISTRIBUTOR_DELEGATED: "distributor_delegated_access",
});

const DISTRIBUTOR_ADMIN_ROLES = new Set(["owner", "admin"]);

const activeCompanyQuery = (companyId) => ({
  _id: companyId,
  isActive: { $ne: false },
  lifecycleStatus: { $ne: "archived" },
  isPlatformWorkspace: { $ne: true },
});

const isEligibleDelegatedUser = (user) =>
  Boolean(
    user &&
      user.accountStatus === "active" &&
      user.isApproved === true &&
      !["pending", "expired"].includes(user.invitationStatus),
  );

const findDelegatedAccess = async ({ userId, companyId, user: suppliedUser }) => {
  const user = suppliedUser;

  if (!isEligibleDelegatedUser(user)) return null;

  const company = await Company.findOne(activeCompanyQuery(companyId));
  if (!company?.organizationId) return null;

  const organization = await Organization.findOne({
    _id: company.organizationId,
    status: "active",
    isActive: true,
    organizationType: "distributor",
  });
  if (!organization || !isDistributorOrganization(organization)) return null;

  const organizationMembership = await OrganizationMembership.findOne({
    organizationId: organization._id,
    userId,
    status: "active",
    isActive: true,
    role: { $in: [...DISTRIBUTOR_ADMIN_ROLES] },
  });
  if (!organizationMembership) return null;

  return {
    allowed: true,
    accessSource: COMPANY_ACCESS_SOURCES.DISTRIBUTOR_DELEGATED,
    companyRole: null,
    organizationRole: organizationMembership.role,
    companyMembership: null,
    company,
    organization,
  };
};

export const resolveCompanyAccess = async ({
  userId,
  companyId,
  user = null,
}) => {
  const directMemberships = await CompanyMembership.find({
    userId,
    status: "active",
    ...(companyId ? { companyId } : {}),
  }).populate({
    path: "companyId",
      match: {
      isActive: { $ne: false },
      lifecycleStatus: { $ne: "archived" },
      isPlatformWorkspace: { $ne: true },
    },
  });

  const activeMemberships = directMemberships.filter(
    (membership) => membership.companyId,
  );

  if (companyId && activeMemberships.length > 1) {
    return {
      allowed: false,
      reason: "multiple_companies",
      activeMemberships,
    };
  }

  if (companyId && activeMemberships.length) {
    const membership = activeMemberships[0];
    return {
      allowed: true,
      accessSource: COMPANY_ACCESS_SOURCES.DIRECT,
      companyRole: membership.role,
      organizationRole: null,
      companyMembership: membership,
      company: membership.companyId,
      organization: null,
    };
  }

  if (companyId) {
    return findDelegatedAccess({
      userId,
      companyId,
      user: user || null,
    });
  }

  if (!activeMemberships.length) return null;

  if (activeMemberships.length > 1) {
    return {
      allowed: false,
      reason: "multiple_companies",
      activeMemberships,
    };
  }

  const membership = activeMemberships[0];
  return {
    allowed: true,
    accessSource: COMPANY_ACCESS_SOURCES.DIRECT,
    companyRole: membership.role,
    organizationRole: null,
    companyMembership: membership,
    company: membership.companyId,
    organization: null,
  };
};

export default resolveCompanyAccess;
