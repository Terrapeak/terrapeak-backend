import mongoose from "mongoose";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import User from "../models/user.js";
import {
  assertOrganizationRoleAssignment,
  isOrganizationRole,
} from "../utils/roleSeparation.js";
import {
  canSelfManageCompanyAssignments,
  isDistributorOrganization,
  isOrganizationType,
  ORGANIZATION_TYPES,
} from "../utils/organizationTypes.js";
import {
  ORGANIZATION_OWNER_INTEGRITY,
  organizationOwnerIntegrityError,
  resolveOrganizationOwnerIntegrity,
} from "./organizationOwnerIntegrityService.js";

const PLATFORM_ORGANIZATION_ADMIN_ROLES = new Set([
  "platform-owner",
  "platform-admin",
]);
const ORGANIZATION_ADMIN_ROLES = new Set(["owner", "admin"]);
const ORGANIZATION_READER_ROLES = new Set([
  "owner",
  "admin",
  "manager",
  "member",
  "viewer",
]);
const ORGANIZATION_MEMBER_LIST_ROLES = new Set([
  "owner",
  "admin",
  "manager",
]);
const MEMBERSHIP_STATUSES = new Set(["active", "inactive", "removed"]);

export class OrganizationServiceError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "OrganizationServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const serviceError = (statusCode, code, message) =>
  new OrganizationServiceError(statusCode, code, message);

const assertPlatformOrganizationAdmin = (actor) => {
  if (
    !actor ||
    !PLATFORM_ORGANIZATION_ADMIN_ROLES.has(actor.platformRole)
  ) {
    throw serviceError(
      403,
      "PLATFORM_ROLE_REQUIRED",
      "Terrapeak Organization administration access is required."
    );
  }
};

const assertActiveOrganizationRole = (membership, allowedRoles) => {
  if (
    !membership ||
    membership.status !== "active" ||
    !allowedRoles.has(membership.role)
  ) {
    throw serviceError(
      403,
      "ORGANIZATION_ROLE_REQUIRED",
      "A permitted Organization role is required."
    );
  }
};

const assertPlainMetadata = (metadata) => {
  if (
    metadata !== undefined &&
    (metadata === null ||
      typeof metadata !== "object" ||
      Array.isArray(metadata))
  ) {
    throw serviceError(
      400,
      "INVALID_ORGANIZATION_METADATA",
      "Organization metadata must be an object."
    );
  }
};

const mapPersistenceError = (error) => {
  if (error?.code === 11000) {
    return serviceError(
      409,
      "ORGANIZATION_SLUG_CONFLICT",
      "An Organization with this slug already exists."
    );
  }
  return error;
};

const findEligibleOrganizationUser = async (userId) => {
  const user = await User.findById(userId).select(
    "_id name email phone platformRole isApproved accountStatus invitationStatus"
  );

  if (!user) {
    throw serviceError(404, "USER_NOT_FOUND", "User not found.");
  }

  if (!user.isApproved) {
    throw serviceError(
      409,
      "ORGANIZATION_USER_INELIGIBLE",
      "The user must be approved before joining an Organization."
    );
  }

  if (
    user.accountStatus !== "active" ||
    ["pending", "expired"].includes(user.invitationStatus)
  ) {
    throw serviceError(
      409,
      "ORGANIZATION_USER_INELIGIBLE",
      "This user account is not active and cannot become a Distributor Owner.",
    );
  }

  try {
    assertOrganizationRoleAssignment({
      platformRole: user.platformRole || "none",
      organizationRole: "member",
    });
  } catch (error) {
    if (error.code === "PLATFORM_ORGANIZATION_ROLE_CONFLICT") {
      throw serviceError(
        409,
        error.code,
        "Platform users cannot join customer Organizations."
      );
    }
    throw error;
  }

  return user;
};

export const lookupInitialOwner = async ({ email }) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw serviceError(400, "OWNER_EMAIL_REQUIRED", "Owner email is required.");
  }

  const user = await User.findOne({ email: normalizedEmail }).select(
    "_id name email platformRole isApproved accountStatus invitationStatus"
  );
  if (!user) return { exists: false, eligible: true, user: null, reason: null };

  if (user.platformRole && user.platformRole !== "none") {
    return {
      exists: true,
      eligible: false,
      user: { name: user.name, email: user.email },
      reason: "This email belongs to a platform account and cannot become a Distributor Owner.",
    };
  }
  if (
    !user.isApproved ||
    user.accountStatus !== "active" ||
    ["pending", "expired"].includes(user.invitationStatus)
  ) {
    return {
      exists: true,
      eligible: false,
      user: { name: user.name, email: user.email },
      reason: "This TerraPeak customer account is not eligible for Distributor Owner access.",
    };
  }
  return {
    exists: true,
    eligible: true,
    user: { name: user.name, email: user.email },
    reason: null,
  };
};

const findOrCreateInitialOwner = async ({ ownerInput, organizationName }) => {
  const email = String(ownerInput?.email || "").trim().toLowerCase();
  if (!email) {
    throw serviceError(400, "OWNER_EMAIL_REQUIRED", "Owner email is required.");
  }

  let user = await User.findOne({ email });
  let createdUser = null;

  if (user) {
    if (user.platformRole && user.platformRole !== "none") {
      throw serviceError(
        409,
        "PLATFORM_USER_NOT_ELIGIBLE",
        "Platform users cannot become Distributor Owners.",
      );
    }
    user = await findEligibleOrganizationUser(user._id);
    return { user, createdUser };
  }

  if (!ownerInput.name?.trim()) {
    throw serviceError(400, "OWNER_NAME_REQUIRED", "Owner full name is required.");
  }
  if (!ownerInput.phone?.trim()) {
    throw serviceError(400, "OWNER_PHONE_REQUIRED", "Owner phone is required.");
  }
  if (!ownerInput.password || ownerInput.password.length < 8) {
    throw serviceError(
      400,
      "OWNER_PASSWORD_INVALID",
      "Owner password must be at least 8 characters.",
    );
  }

  try {
    user = await User.create({
      name: ownerInput.name.trim(),
      email,
      phone: ownerInput.phone.trim(),
      password: ownerInput.password,
      companyName: organizationName,
      role: "user",
      isAdmin: false,
      platformRole: "none",
      isApproved: true,
      accountStatus: "active",
      mustChangePassword: true,
    });
    createdUser = user;
    return { user, createdUser };
  } catch (error) {
    if (error?.code === 11000) {
      throw serviceError(409, "OWNER_ACCOUNT_CONFLICT", "An account with this email or phone already exists.");
    }
    throw error;
  }
};

const assertOrganizationRole = (role, platformRole = "none") => {
  try {
    assertOrganizationRoleAssignment({
      platformRole,
      organizationRole: role,
    });
  } catch (error) {
    if (error.code === "INVALID_ORGANIZATION_ROLE") {
      throw serviceError(
        400,
        error.code,
        "Invalid Organization role."
      );
    }
    if (error.code === "PLATFORM_ORGANIZATION_ROLE_CONFLICT") {
      throw serviceError(
        409,
        error.code,
        "Platform users cannot join customer Organizations."
      );
    }
    throw error;
  }
};

const getOrganizationOrThrow = async (organizationId) => {
  const organization = await Organization.findById(organizationId);
  if (!organization) {
    throw serviceError(
      404,
      "ORGANIZATION_NOT_FOUND",
      "Organization not found."
    );
  }
  return organization;
};

export const databaseSupportsTransactions = (
  connection = mongoose.connection
) => {
  const topologyType =
    connection?.getClient?.()?.topology?.description?.type;
  return ["ReplicaSetWithPrimary", "Sharded"].includes(topologyType);
};

const getOrganizationTypeOrDefault = (value) => {
  const organizationType = value === undefined
    ? ORGANIZATION_TYPES.DIRECT_CUSTOMER
    : value;
  if (!isOrganizationType(organizationType)) {
    throw serviceError(
      400,
      "INVALID_ORGANIZATION_TYPE",
      "Organization type is invalid.",
    );
  }
  return organizationType;
};

const buildOrganizationPayload = ({ actor, input }) => ({
    name: input.name,
    slug: input.slug,
    status: input.status || "active",
    metadata: input.metadata || {},
    organizationType: getOrganizationTypeOrDefault(input.organizationType),
    createdByUserId: actor._id,
});

const buildInitialOwnerMembershipPayload = ({
  actor,
  organization,
  initialOwner,
}) => ({
  organizationId: organization._id,
  userId: initialOwner._id,
  role: "owner",
  status: "active",
  invitedByUserId: actor._id,
});

const createOrganizationDocuments = async ({
  actor,
  input,
  initialOwner,
  session,
}) => {
  const organizationPayload = buildOrganizationPayload({ actor, input });
  const organization = session
    ? (await Organization.create([organizationPayload], { session }))[0]
    : await Organization.create(organizationPayload);

  let initialOwnerMembership = null;
  if (initialOwner) {
    const membershipPayload = buildInitialOwnerMembershipPayload({
      actor,
      organization,
      initialOwner,
    });
    initialOwnerMembership = session
      ? (
          await OrganizationMembership.create([membershipPayload], {
            session,
          })
        )[0]
      : await OrganizationMembership.create(membershipPayload);
  }

  return {
    organization,
    initialOwnerMembership,
    initialOwnerUser: initialOwner,
    platformManaged: !initialOwnerMembership,
  };
};

export const createOrganization = async ({
  actor,
  input,
  transactionSupported = databaseSupportsTransactions(),
}) => {
  assertPlatformOrganizationAdmin(actor);
  assertPlainMetadata(input.metadata);

  const initialOwnerUserId = input.initialOwnerUserId || null;
  const ownerInput = input.initialOwner || null;
  let initialOwner = null;
  let createdOwner = null;

  if (ownerInput) {
    if (input.organizationType !== "distributor") {
      throw serviceError(
        400,
        "INITIAL_OWNER_NOT_SUPPORTED",
        "Initial owner details are currently supported for Distributor Organizations.",
      );
    }
    const ownerResult = await findOrCreateInitialOwner({
      ownerInput,
      organizationName: input.name,
    });
    initialOwner = ownerResult.user;
    createdOwner = ownerResult.createdUser;
  } else if (initialOwnerUserId) {
    initialOwner = await findEligibleOrganizationUser(initialOwnerUserId);
    assertOrganizationRole("owner", initialOwner.platformRole || "none");
  }

  if (initialOwner && transactionSupported && !createdOwner) {
    const session = await mongoose.startSession();
    let result;

    try {
      await session.withTransaction(async () => {
        result = await createOrganizationDocuments({
          actor,
          input,
          initialOwner,
          session,
        });
      });
      return result;
    } catch (error) {
      throw mapPersistenceError(error);
    } finally {
      await session.endSession();
    }
  }

  let organization = null;
  try {
    organization = await Organization.create(
      buildOrganizationPayload({ actor, input })
    );
    let initialOwnerMembership = null;
    if (initialOwner) {
      initialOwnerMembership = await OrganizationMembership.create(
        buildInitialOwnerMembershipPayload({
          actor,
          organization,
          initialOwner,
        })
      );
    }
    return {
      organization,
      initialOwnerMembership,
      initialOwnerUser: initialOwner,
      platformManaged: !initialOwnerMembership,
    };
  } catch (error) {
    if (organization?._id) {
      try {
        const rollbackResult = await Organization.deleteOne({
          _id: organization._id,
        });
        if (rollbackResult.deletedCount !== 1) {
          throw new Error("Organization rollback did not delete a record.");
        }
      } catch (rollbackError) {
        const rollbackFailure = serviceError(
          500,
          "ORGANIZATION_CREATION_ROLLBACK_FAILED",
          "Organization creation failed and requires manual cleanup."
        );
        rollbackFailure.cause = rollbackError;
        throw rollbackFailure;
      }
    }

    if (createdOwner?._id) {
      try {
        await User.deleteOne({ _id: createdOwner._id });
      } catch (rollbackError) {
        const rollbackFailure = serviceError(
          500,
          "ORGANIZATION_CREATION_ROLLBACK_FAILED",
          "Organization creation failed and requires manual cleanup.",
        );
        rollbackFailure.cause = rollbackError;
        throw rollbackFailure;
      }
    }

    if (error?.code === 11000 && error?.keyPattern?.organizationId) {
      throw serviceError(
        409,
        "ORGANIZATION_MEMBERSHIP_EXISTS",
        "This user already belongs to the Organization.",
      );
    }
    throw mapPersistenceError(error);
  }
};

export const listPlatformOrganizations = async ({ actor }) => {
  assertPlatformOrganizationAdmin(actor);
  return Organization.find({}).sort({ createdAt: -1 });
};

export const readPlatformOrganization = async ({
  actor,
  organizationId,
}) => {
  assertPlatformOrganizationAdmin(actor);
  return getOrganizationOrThrow(organizationId);
};

const PLATFORM_MEMBER_ROLE_ORDER = {
  owner: 0,
  admin: 1,
  manager: 2,
  member: 3,
  viewer: 4,
};

export const listPlatformOrganizationMembers = async ({
  actor,
  organizationId,
}) => {
  assertPlatformOrganizationAdmin(actor);
  await getOrganizationOrThrow(organizationId);

  const memberships = await OrganizationMembership.find({ organizationId })
    .populate("userId", "_id name email")
    .sort({ createdAt: 1 });

  return memberships.sort((left, right) => {
    const roleDifference =
      (PLATFORM_MEMBER_ROLE_ORDER[left.role] ?? Number.MAX_SAFE_INTEGER) -
      (PLATFORM_MEMBER_ROLE_ORDER[right.role] ?? Number.MAX_SAFE_INTEGER);
    if (roleDifference !== 0) return roleDifference;

    const leftUser = left.userId && typeof left.userId === "object" ? left.userId : {};
    const rightUser = right.userId && typeof right.userId === "object" ? right.userId : {};
    const nameDifference = String(leftUser.name || "").localeCompare(String(rightUser.name || ""));
    if (nameDifference !== 0) return nameDifference;
    return String(leftUser.email || "").localeCompare(String(rightUser.email || ""));
  });
};

const applyOrganizationUpdates = async (
  organization,
  updates,
  { allowOrganizationType = false } = {},
) => {
  const editableFields = ["name", "slug", "status", "metadata"];
  if (allowOrganizationType) editableFields.push("organizationType");
  assertPlainMetadata(updates.metadata);

  for (const field of editableFields) {
    if (updates[field] !== undefined) {
      organization[field] = updates[field];
    }
  }

  try {
    await organization.save();
  } catch (error) {
    throw mapPersistenceError(error);
  }

  return organization;
};

export const updatePlatformOrganization = async ({
  actor,
  organizationId,
  updates,
}) => {
  assertPlatformOrganizationAdmin(actor);
  const organization = await getOrganizationOrThrow(organizationId);
  return applyOrganizationUpdates(organization, updates, {
    allowOrganizationType: true,
  });
};

export const listAvailableOrganizations = async ({ userId }) => {
  const user = await User.findById(userId).select(
    "_id platformRole isApproved"
  );

  if (
    !user ||
    !user.isApproved ||
    (user.platformRole && user.platformRole !== "none")
  ) {
    throw serviceError(
      403,
      "ORGANIZATION_ACCESS_DENIED",
      "Organization access is not available for this user."
    );
  }

  return OrganizationMembership.find({
    userId: user._id,
    status: "active",
  }).populate({
    path: "organizationId",
    match: { status: "active" },
  });
};

export const readOrganization = async ({
  organization,
  membership,
}) => {
  assertActiveOrganizationRole(membership, ORGANIZATION_READER_ROLES);
  return organization;
};

export const updateOrganization = async ({
  organization,
  membership,
  updates,
}) => {
  assertActiveOrganizationRole(membership, ORGANIZATION_ADMIN_ROLES);
  return applyOrganizationUpdates(organization, updates);
};

export const listOrganizationMembers = async ({
  organization,
  membership,
}) => {
  assertActiveOrganizationRole(
    membership,
    ORGANIZATION_MEMBER_LIST_ROLES
  );

  return OrganizationMembership.find({
    organizationId: organization._id,
    status: { $ne: "removed" },
  })
    .populate("userId", "_id name email")
    .sort({ createdAt: 1 });
};

export const addOrganizationMember = async ({
  organization,
  actorMembership,
  input,
}) => {
  assertActiveOrganizationRole(
    actorMembership,
    ORGANIZATION_ADMIN_ROLES
  );
  assertOrganizationRole(input.role);

  if (actorMembership.role === "admin" && input.role === "owner") {
    throw serviceError(
      403,
      "ORGANIZATION_ROLE_REQUIRED",
      "Only an Organization owner may assign the owner role."
    );
  }

  if (input.role === "owner") {
    const ownerIntegrity = await resolveOrganizationOwnerIntegrity({
      organizationId: organization._id,
    });
    if (ownerIntegrity.status === ORGANIZATION_OWNER_INTEGRITY.MULTIPLE_OWNERS) {
      throw organizationOwnerIntegrityError();
    }
    if (ownerIntegrity.status === ORGANIZATION_OWNER_INTEGRITY.VALID) {
      throw serviceError(
        409,
        "ORGANIZATION_ALREADY_HAS_OWNER",
        "This Organization already has an active owner.",
      );
    }
  }

  const user = await findEligibleOrganizationUser(input.userId);
  assertOrganizationRole(input.role, user.platformRole || "none");

  const existing = await OrganizationMembership.findOne({
    organizationId: organization._id,
    userId: user._id,
  }).select("_id status");

  if (existing) {
    throw serviceError(
      409,
      "ORGANIZATION_MEMBERSHIP_EXISTS",
      "This user already has an Organization membership."
    );
  }

  try {
    return await OrganizationMembership.create({
      organizationId: organization._id,
      userId: user._id,
      role: input.role,
      status: "active",
      invitedByUserId: actorMembership.userId,
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw serviceError(
        409,
        "ORGANIZATION_MEMBERSHIP_EXISTS",
        "This user already has an Organization membership."
      );
    }
    throw error;
  }
};

export const assignInitialOrganizationOwner = async ({
  actor,
  organizationId,
  userId,
}) => {
  assertPlatformOrganizationAdmin(actor);
  const organization = await getOrganizationOrThrow(organizationId);
  const ownerIntegrity = await resolveOrganizationOwnerIntegrity({
    organizationId: organization._id,
  });
  if (ownerIntegrity.status === ORGANIZATION_OWNER_INTEGRITY.MULTIPLE_OWNERS) {
    throw organizationOwnerIntegrityError();
  }
  if (ownerIntegrity.status === ORGANIZATION_OWNER_INTEGRITY.VALID) {
    throw serviceError(
      409,
      "ORGANIZATION_OWNER_EXISTS",
      "This Organization already has an active owner."
    );
  }

  const user = await findEligibleOrganizationUser(userId);
  assertOrganizationRole("owner", user.platformRole || "none");

  const existing = await OrganizationMembership.findOne({
    organizationId: organization._id,
    userId: user._id,
  });

  if (existing) {
    existing.role = "owner";
    existing.status = "active";
    existing.invitedByUserId = actor._id;
    await existing.save();
    return existing;
  }

  return OrganizationMembership.create({
    organizationId: organization._id,
    userId: user._id,
    role: "owner",
    status: "active",
    invitedByUserId: actor._id,
  });
};

const ensureOwnerRetained = async ({
  organizationId,
  targetMembership,
  nextRole,
  nextStatus,
}) => {
  const removesActiveOwner =
    targetMembership.role === "owner" &&
    targetMembership.status === "active" &&
    (nextRole !== "owner" || nextStatus !== "active");

  if (!removesActiveOwner) return;

  const replacementOwner = await OrganizationMembership.findOne({
    organizationId,
    _id: { $ne: targetMembership._id },
    role: "owner",
    status: "active",
  }).select("_id");

  if (!replacementOwner) {
    throw serviceError(
      409,
      "ORGANIZATION_FINAL_OWNER_REQUIRED",
      "An Organization must retain at least one active owner."
    );
  }
};

const getTargetMembership = async ({
  organizationId,
  membershipId,
}) => {
  const target = await OrganizationMembership.findOne({
    _id: membershipId,
    organizationId,
  });

  if (!target) {
    throw serviceError(
      404,
      "ORGANIZATION_MEMBERSHIP_NOT_FOUND",
      "Organization membership not found."
    );
  }

  return target;
};

export const updateOrganizationMember = async ({
  organization,
  actorMembership,
  membershipId,
  updates,
}) => {
  assertActiveOrganizationRole(
    actorMembership,
    ORGANIZATION_ADMIN_ROLES
  );

  const target = await getTargetMembership({
    organizationId: organization._id,
    membershipId,
  });
  const nextRole = updates.role ?? target.role;
  const nextStatus = updates.status ?? target.status;

  if (!isOrganizationRole(nextRole)) {
    throw serviceError(
      400,
      "INVALID_ORGANIZATION_ROLE",
      "Invalid Organization role."
    );
  }
  if (!MEMBERSHIP_STATUSES.has(nextStatus)) {
    throw serviceError(
      400,
      "INVALID_ORGANIZATION_MEMBERSHIP_STATUS",
      "Invalid Organization membership status."
    );
  }

  if (
    actorMembership.role === "admin" &&
    (target.role === "owner" || nextRole === "owner")
  ) {
    throw serviceError(
      403,
      "ORGANIZATION_ROLE_REQUIRED",
      "Organization administrators cannot manage owners."
    );
  }

  const promotingToOwner =
    target.role !== "owner" &&
    nextRole === "owner" &&
    nextStatus === "active";
  if (promotingToOwner) {
    const ownerIntegrity = await resolveOrganizationOwnerIntegrity({
      organizationId: organization._id,
    });
    if (ownerIntegrity.status === ORGANIZATION_OWNER_INTEGRITY.MULTIPLE_OWNERS) {
      throw organizationOwnerIntegrityError();
    }
    if (ownerIntegrity.status === ORGANIZATION_OWNER_INTEGRITY.VALID) {
      throw serviceError(
        409,
        "ORGANIZATION_ALREADY_HAS_OWNER",
        "This Organization already has an active owner.",
      );
    }
  }

  if (nextStatus === "active") {
    const user = await findEligibleOrganizationUser(target.userId);
    assertOrganizationRole(nextRole, user.platformRole || "none");
  }

  await ensureOwnerRetained({
    organizationId: organization._id,
    targetMembership: target,
    nextRole,
    nextStatus,
  });

  target.role = nextRole;
  target.status = nextStatus;
  await target.save();
  return target;
};

export const removeOrganizationMember = async ({
  organization,
  actorMembership,
  membershipId,
}) => {
  assertActiveOrganizationRole(
    actorMembership,
    ORGANIZATION_ADMIN_ROLES
  );

  const target = await getTargetMembership({
    organizationId: organization._id,
    membershipId,
  });

  if (
    actorMembership.role === "admin" &&
    target.role === "owner"
  ) {
    throw serviceError(
      403,
      "ORGANIZATION_ROLE_REQUIRED",
      "Organization administrators cannot remove owners."
    );
  }

  await ensureOwnerRetained({
    organizationId: organization._id,
    targetMembership: target,
    nextRole: target.role,
    nextStatus: "removed",
  });

  target.status = "removed";
  await target.save();
  return target;
};

const assertCompanyMutationAccess = ({
  actorMembership,
  platformActor,
}) => {
  if (platformActor) {
    assertPlatformOrganizationAdmin(platformActor);
    return;
  }
  assertActiveOrganizationRole(
    actorMembership,
    ORGANIZATION_ADMIN_ROLES
  );
};

const assertCustomerCompanyAdministration = async ({
  actorMembership,
  companyId,
}) => {
  const companyMembership = await CompanyMembership.findOne({
    companyId,
    userId: actorMembership.userId,
    status: "active",
    role: { $in: ["owner", "admin"] },
  }).select("_id");

  if (!companyMembership) {
    throw serviceError(
      403,
      "COMPANY_ACCESS_DENIED",
      "Active Company owner or administrator access is required."
    );
  }
};

export const listOrganizationCompanies = async ({
  organization,
  membership,
  platformActor,
}) => {
  if (platformActor) {
    assertPlatformOrganizationAdmin(platformActor);
  } else {
    assertActiveOrganizationRole(
      membership,
      ORGANIZATION_READER_ROLES
    );
  }

  const canManageArchived =
    isDistributorOrganization(organization) &&
    (platformActor || ["owner", "admin"].includes(membership?.role));
  const lifecycleFilter = canManageArchived
    ? {}
    : {
        isActive: { $ne: false },
        lifecycleStatus: { $ne: "archived" },
      };

  return Company.find({ organizationId: organization._id, ...lifecycleFilter }).sort({
    name: 1,
  });
};

export const assignCompanyToOrganization = async ({
  organization,
  companyId,
  actorMembership,
  platformActor,
}) => {
  assertCompanyMutationAccess({ actorMembership, platformActor });

  if (!platformActor && !canSelfManageCompanyAssignments(organization)) {
    throw serviceError(
      403,
      "ORGANIZATION_COMPANY_SELF_SERVICE_DISABLED",
      "Distributor Organizations cannot self-attach existing Companies.",
    );
  }

  if (organization.status !== "active") {
    throw serviceError(
      409,
      "ORGANIZATION_INACTIVE",
      "Companies can only be assigned to an active Organization."
    );
  }

  const company = await Company.findById(companyId);
  if (!company) {
    throw serviceError(404, "COMPANY_NOT_FOUND", "Company not found.");
  }

  if (
    company.organizationId &&
    String(company.organizationId) !== String(organization._id)
  ) {
    throw serviceError(
      409,
      "COMPANY_ALREADY_ASSIGNED",
      "This Company already belongs to another Organization."
    );
  }

  if (!platformActor) {
    await assertCustomerCompanyAdministration({
      actorMembership,
      companyId: company._id,
    });
  }

  if (!company.organizationId) {
    company.organizationId = organization._id;
    await company.save();
  }

  return company;
};

export const removeCompanyFromOrganization = async ({
  organization,
  companyId,
  actorMembership,
  platformActor,
}) => {
  assertCompanyMutationAccess({ actorMembership, platformActor });

  if (!platformActor && !canSelfManageCompanyAssignments(organization)) {
    throw serviceError(
      403,
      "ORGANIZATION_COMPANY_SELF_SERVICE_DISABLED",
      "Distributor Organizations cannot self-detach or reassign Companies.",
    );
  }

  const company = await Company.findById(companyId);
  if (!company) {
    throw serviceError(404, "COMPANY_NOT_FOUND", "Company not found.");
  }

  if (
    !company.organizationId ||
    String(company.organizationId) !== String(organization._id)
  ) {
    throw serviceError(
      403,
      "ORGANIZATION_ACCESS_DENIED",
      "This Company does not belong to the selected Organization."
    );
  }

  if (!platformActor) {
    await assertCustomerCompanyAdministration({
      actorMembership,
      companyId: company._id,
    });
  }

  company.organizationId = null;
  await company.save();
  return company;
};
