export const ACTIVE_ORGANIZATION_MEMBERSHIP_CONFLICT =
  "ACTIVE_ORGANIZATION_MEMBERSHIP_CONFLICT";

export class PlatformAccessConflictError extends Error {
  constructor() {
    super(
      "A user with an active Organization membership cannot receive platform access."
    );
    this.name = "PlatformAccessConflictError";
    this.code = ACTIVE_ORGANIZATION_MEMBERSHIP_CONFLICT;
    this.statusCode = 409;
  }
}

export const grantsPlatformAccess = ({
  platformRole = "none",
  isAdmin = false,
}) => platformRole !== "none" || isAdmin === true;

const getOrganizationMembershipModel = async (providedModel) => {
  if (providedModel) return providedModel;
  const module = await import("../models/organizationMembership.js");
  return module.default;
};

export const assertPlatformAccessAssignmentAllowed = async ({
  userId,
  userIds,
  platformRole = "none",
  isAdmin = false,
  OrganizationMembershipModel,
}) => {
  if (!grantsPlatformAccess({ platformRole, isAdmin })) return;

  const ids = userIds || (userId ? [userId] : []);
  if (!ids.length) return;

  const MembershipModel = await getOrganizationMembershipModel(
    OrganizationMembershipModel
  );
  const conflict = await MembershipModel.exists({
    userId: ids.length === 1 ? ids[0] : { $in: ids },
    status: "active",
  });

  if (conflict) {
    throw new PlatformAccessConflictError();
  }
};

export const applyPlatformAccessMutation = async ({
  user,
  updates,
  OrganizationMembershipModel,
}) => {
  const nextPlatformRole =
    updates.platformRole !== undefined
      ? updates.platformRole
      : user.platformRole || "none";
  const nextIsAdmin =
    updates.isAdmin !== undefined ? updates.isAdmin : user.isAdmin === true;

  await assertPlatformAccessAssignmentAllowed({
    userId: user._id,
    platformRole: nextPlatformRole,
    isAdmin: nextIsAdmin,
    OrganizationMembershipModel,
  });

  for (const field of ["platformRole", "isAdmin", "role"]) {
    if (updates[field] !== undefined) user[field] = updates[field];
  }

  return user;
};

export const extractPlatformAccessUpdate = (sourceUpdate = {}) => {
  const setUpdate = sourceUpdate.$set || {};
  const setOnInsert = sourceUpdate.$setOnInsert || {};
  const platformRole =
    setUpdate.platformRole ??
    sourceUpdate.platformRole ??
    setOnInsert.platformRole;
  const isAdmin =
    setUpdate.isAdmin ?? sourceUpdate.isAdmin ?? setOnInsert.isAdmin;

  return {
    touchesPlatformRole: platformRole !== undefined,
    touchesIsAdmin: isAdmin !== undefined,
    platformRole,
    isAdmin,
  };
};
