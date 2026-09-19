import OrganizationMembership from "../models/organizationMembership.js";

export const ORGANIZATION_OWNER_INTEGRITY = Object.freeze({
  OWNERLESS: "ownerless",
  VALID: "valid",
  MULTIPLE_OWNERS: "multiple_owners",
});

export const organizationOwnerIntegrityError = (message = "Organization owner integrity could not be verified.") => {
  const error = new Error(message);
  error.code = "ORGANIZATION_OWNER_INTEGRITY_ERROR";
  error.statusCode = 409;
  return error;
};

const applySession = (query, session) =>
  session && typeof query.session === "function" ? query.session(session) : query;

export const resolveOrganizationOwnerIntegrity = async ({
  organizationId,
  session,
  MembershipModel = OrganizationMembership,
}) => {
  const query = MembershipModel.find({
    organizationId,
    role: "owner",
    status: "active",
  });
  const memberships = await applySession(query, session);
  const ownerCount = memberships.length;

  return {
    status:
      ownerCount === 0
        ? ORGANIZATION_OWNER_INTEGRITY.OWNERLESS
        : ownerCount === 1
          ? ORGANIZATION_OWNER_INTEGRITY.VALID
          : ORGANIZATION_OWNER_INTEGRITY.MULTIPLE_OWNERS,
    ownerCount,
    ownerMembership: ownerCount === 1 ? memberships[0] : null,
  };
};

export const requireSingleOrganizationOwner = async (options) => {
  const integrity = await resolveOrganizationOwnerIntegrity(options);
  if (integrity.status === ORGANIZATION_OWNER_INTEGRITY.MULTIPLE_OWNERS) {
    throw organizationOwnerIntegrityError();
  }
  return integrity;
};
