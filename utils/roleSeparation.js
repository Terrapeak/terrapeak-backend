export const PLATFORM_ROLES = Object.freeze([
  "none",
  "platform-owner",
  "platform-admin",
  "support-admin",
  "billing-admin",
  "developer-admin",
  "sales-admin",
  "viewer",
]);

export const COMPANY_MEMBERSHIP_ROLES = Object.freeze([
  "owner",
  "admin",
  "manager",
  "staff",
  "viewer",
]);

export const ORGANIZATION_ROLES = Object.freeze([
  "owner",
  "admin",
  "manager",
  "member",
  "viewer",
]);

const platformRoleSet = new Set(PLATFORM_ROLES);
const companyMembershipRoleSet = new Set(COMPANY_MEMBERSHIP_ROLES);
const organizationRoleSet = new Set(ORGANIZATION_ROLES);

export const isPlatformRole = (role) => platformRoleSet.has(role);

export const isCompanyMembershipRole = (role) =>
  companyMembershipRoleSet.has(role);

export const isOrganizationRole = (role) => organizationRoleSet.has(role);

export const assertPlatformRole = (role) => {
  if (!isPlatformRole(role)) {
    const error = new Error("Invalid platform role.");
    error.code = "INVALID_PLATFORM_ROLE";
    throw error;
  }

  return role;
};

export const assertOrganizationRoleAssignment = ({
  platformRole = "none",
  organizationRole,
}) => {
  if (!isOrganizationRole(organizationRole)) {
    const error = new Error("Invalid organization role.");
    error.code = "INVALID_ORGANIZATION_ROLE";
    throw error;
  }

  if (platformRole !== "none") {
    const error = new Error(
      "Platform users cannot receive organization roles."
    );
    error.code = "PLATFORM_ORGANIZATION_ROLE_CONFLICT";
    throw error;
  }

  return organizationRole;
};
