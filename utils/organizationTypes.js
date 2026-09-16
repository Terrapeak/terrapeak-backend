export const ORGANIZATION_TYPES = Object.freeze({
  DIRECT_CUSTOMER: "direct_customer",
  DISTRIBUTOR: "distributor",
  ENTERPRISE_GROUP: "enterprise_group",
});

export const ORGANIZATION_TYPE_VALUES = Object.freeze(
  Object.values(ORGANIZATION_TYPES),
);

export const normalizeOrganizationType = (value) =>
  ORGANIZATION_TYPE_VALUES.includes(value)
    ? value
    : ORGANIZATION_TYPES.DIRECT_CUSTOMER;

export const isOrganizationType = (value) =>
  ORGANIZATION_TYPE_VALUES.includes(value);

export const isDistributorOrganization = (organization) =>
  normalizeOrganizationType(organization?.organizationType) ===
  ORGANIZATION_TYPES.DISTRIBUTOR;

export const isDirectCustomerOrganization = (organization) =>
  normalizeOrganizationType(organization?.organizationType) ===
  ORGANIZATION_TYPES.DIRECT_CUSTOMER;

export const isEnterpriseGroupOrganization = (organization) =>
  normalizeOrganizationType(organization?.organizationType) ===
  ORGANIZATION_TYPES.ENTERPRISE_GROUP;

export const canSelfManageCompanyAssignments = (organization) =>
  !isDistributorOrganization(organization);

