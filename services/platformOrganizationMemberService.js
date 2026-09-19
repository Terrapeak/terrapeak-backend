import mongoose from "mongoose";

import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import OrganizationMembershipAudit from "../models/organizationMembershipAudit.js";
import User from "../models/user.js";
import {
  ORGANIZATION_OWNER_INTEGRITY,
  organizationOwnerIntegrityError,
  resolveOrganizationOwnerIntegrity,
} from "./organizationOwnerIntegrityService.js";
import { databaseSupportsTransactions } from "./organizationService.js";

const PLATFORM_ADMIN_ROLES = new Set(["platform-owner", "platform-admin"]);
const ORDINARY_ROLES = new Set(["admin", "manager", "member", "viewer"]);
const ACTIVE_USER_FIELDS = "_id name email phone platformRole isApproved accountStatus invitationStatus";

const serviceError = (statusCode, code, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const assertPlatformAdmin = (actor) => {
  if (!actor || !PLATFORM_ADMIN_ROLES.has(actor.platformRole)) {
    throw serviceError(403, "PLATFORM_ROLE_REQUIRED", "Platform Organization administration access is required.");
  }
};

const applySession = (query, session) =>
  session && typeof query.session === "function" ? query.session(session) : query;

const assertOrdinaryRole = (role) => {
  if (!ORDINARY_ROLES.has(role)) {
    throw serviceError(400, "ORGANIZATION_MEMBER_ROLE_INVALID", "Platform member management cannot assign the owner role.");
  }
};

const validateUserEligibility = (user) => {
  if (!user) throw serviceError(404, "USER_NOT_FOUND", "User not found.");
  if (user.platformRole && user.platformRole !== "none") {
    throw serviceError(409, "PLATFORM_ORGANIZATION_ROLE_CONFLICT", "Platform users cannot join customer Organizations.");
  }
  if (!user.isApproved || user.accountStatus !== "active" || ["pending", "expired"].includes(user.invitationStatus)) {
    throw serviceError(409, "ORGANIZATION_USER_INELIGIBLE", "This user account is not eligible for Organization membership.");
  }
};

const getOrganization = async (organizationId, session) => {
  const organization = await applySession(Organization.findById(organizationId), session);
  if (!organization) throw serviceError(404, "ORGANIZATION_NOT_FOUND", "Organization not found.");

  const integrity = await resolveOrganizationOwnerIntegrity({
    organizationId: organization._id,
    session,
  });
  if (integrity.status === ORGANIZATION_OWNER_INTEGRITY.MULTIPLE_OWNERS) {
    throw organizationOwnerIntegrityError("This Organization has multiple active owners and requires integrity review.");
  }
  return organization;
};

const loadUser = async (userId, session) =>
  applySession(User.findById(userId).select(ACTIVE_USER_FIELDS), session);

const loadUserByEmail = async (email, session) =>
  applySession(User.findOne({ email }).select(ACTIVE_USER_FIELDS), session);

const saveAudit = async ({ eventType, organization, membership, user, actor, beforeRole, beforeStatus, session }) => {
  await OrganizationMembershipAudit.create([{
    eventType,
    organizationId: organization._id,
    membershipId: membership._id,
    affectedUserId: user._id,
    actorUserId: actor._id,
    actorPlatformRole: actor.platformRole,
    action: eventType.replace("organization_member_", ""),
    beforeRole,
    afterRole: membership.role,
    beforeStatus,
    afterStatus: membership.status,
  }], { session });
};

const result = (membership, user) => ({ membership, user });

export const addPlatformOrganizationMember = async ({
  actor,
  organizationId,
  email,
  role,
  transactionSupported = databaseSupportsTransactions(),
  startSession = () => mongoose.startSession(),
}) => {
  assertPlatformAdmin(actor);
  assertOrdinaryRole(role);
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw serviceError(400, "USER_EMAIL_REQUIRED", "A User email is required.");
  if (!transactionSupported) throw serviceError(503, "ORGANIZATION_MEMBER_REQUIRES_TRANSACTION", "Organization member changes require a transactional MongoDB connection.");

  const session = await startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      const organization = await getOrganization(organizationId, session);
      const user = await loadUserByEmail(normalizedEmail, session);
      validateUserEligibility(user);
      const duplicate = await applySession(OrganizationMembership.findOne({ organizationId: organization._id, userId: user._id }), session);
      if (duplicate) throw serviceError(409, "ORGANIZATION_MEMBERSHIP_EXISTS", "This user already belongs to the Organization.");
      const membership = await OrganizationMembership.create([{
        organizationId: organization._id,
        userId: user._id,
        role,
        status: "active",
        invitedByUserId: actor._id,
      }], { session }).then(([entry]) => entry);
      await saveAudit({ eventType: "organization_member_added", organization, membership, user, actor, beforeRole: null, beforeStatus: null, session });
      created = result(membership, user);
    });
    return created;
  } catch (error) {
    if (error?.code === 11000) throw serviceError(409, "ORGANIZATION_MEMBERSHIP_EXISTS", "This user already belongs to the Organization.");
    throw error;
  } finally {
    await session.endSession();
  }
};

export const updatePlatformOrganizationMember = async ({
  actor,
  organizationId,
  membershipId,
  role,
  status,
  transactionSupported = databaseSupportsTransactions(),
  startSession = () => mongoose.startSession(),
}) => {
  assertPlatformAdmin(actor);
  if (role !== undefined) assertOrdinaryRole(role);
  if (status !== undefined && !["active", "inactive"].includes(status)) {
    throw serviceError(400, "ORGANIZATION_MEMBER_STATUS_INVALID", "Platform member updates support only active or inactive status.");
  }
  if (role === undefined && status === undefined) throw serviceError(400, "ORGANIZATION_MEMBER_UPDATE_EMPTY", "A role or status change is required.");
  if (!transactionSupported) throw serviceError(503, "ORGANIZATION_MEMBER_REQUIRES_TRANSACTION", "Organization member changes require a transactional MongoDB connection.");

  const initialMembership = await OrganizationMembership.findOne({ _id: membershipId, organizationId }).select("_id memberManagementVersion");
  if (!initialMembership) throw serviceError(404, "ORGANIZATION_MEMBERSHIP_NOT_FOUND", "Organization membership not found.");
  const initialVersion = initialMembership.memberManagementVersion || 0;

  const session = await startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      const organization = await getOrganization(organizationId, session);
      const membership = await applySession(OrganizationMembership.findOne({ _id: membershipId, organizationId: organization._id }), session);
      if (!membership) throw serviceError(404, "ORGANIZATION_MEMBERSHIP_NOT_FOUND", "Organization membership not found.");
      if ((membership.memberManagementVersion || 0) !== initialVersion) throw serviceError(409, "ORGANIZATION_MEMBER_CONFLICT", "This membership changed while the request was in progress. Please reload and try again.");
      if (membership.role === "owner") throw serviceError(409, "ORGANIZATION_OWNER_MANAGED_SEPARATELY", "Ownership is managed through Change owner.");
      if (role !== undefined && membership.status !== "active") throw serviceError(409, "ORGANIZATION_MEMBER_REACTIVATE_FIRST", "Reactivate the membership before changing its role.");
      const user = await loadUser(membership.userId, session);
      if (status === "active") validateUserEligibility(user);
      const beforeRole = membership.role;
      const beforeStatus = membership.status;
      membership.role = role ?? membership.role;
      membership.status = status ?? membership.status;
      membership.memberManagementVersion = initialVersion + 1;
      await membership.save({ session });
      const eventType = beforeRole !== membership.role
        ? "organization_member_role_changed"
        : membership.status === "active"
          ? "organization_member_reactivated"
          : "organization_member_deactivated";
      await saveAudit({ eventType, organization, membership, user, actor, beforeRole, beforeStatus, session });
      updated = result(membership, user);
    });
    return updated;
  } finally {
    await session.endSession();
  }
};

export const removePlatformOrganizationMember = async ({
  actor,
  organizationId,
  membershipId,
  transactionSupported = databaseSupportsTransactions(),
  startSession = () => mongoose.startSession(),
}) => {
  assertPlatformAdmin(actor);
  if (!transactionSupported) throw serviceError(503, "ORGANIZATION_MEMBER_REQUIRES_TRANSACTION", "Organization member changes require a transactional MongoDB connection.");

  const initialMembership = await OrganizationMembership.findOne({ _id: membershipId, organizationId }).select("_id memberManagementVersion");
  if (!initialMembership) throw serviceError(404, "ORGANIZATION_MEMBERSHIP_NOT_FOUND", "Organization membership not found.");
  const initialVersion = initialMembership.memberManagementVersion || 0;

  const session = await startSession();
  let removed;
  try {
    await session.withTransaction(async () => {
      const organization = await getOrganization(organizationId, session);
      const membership = await applySession(OrganizationMembership.findOne({ _id: membershipId, organizationId: organization._id }), session);
      if (!membership) throw serviceError(404, "ORGANIZATION_MEMBERSHIP_NOT_FOUND", "Organization membership not found.");
      if ((membership.memberManagementVersion || 0) !== initialVersion) throw serviceError(409, "ORGANIZATION_MEMBER_CONFLICT", "This membership changed while the request was in progress. Please reload and try again.");
      if (membership.role === "owner") throw serviceError(409, "ORGANIZATION_OWNER_MANAGED_SEPARATELY", "Ownership is managed through Change owner.");
      const user = await loadUser(membership.userId, session);
      const beforeRole = membership.role;
      const beforeStatus = membership.status;
      membership.status = "removed";
      membership.memberManagementVersion = initialVersion + 1;
      await membership.save({ session });
      await saveAudit({ eventType: "organization_member_removed", organization, membership, user, actor, beforeRole, beforeStatus, session });
      removed = result(membership, user);
    });
    return removed;
  } finally {
    await session.endSession();
  }
};
