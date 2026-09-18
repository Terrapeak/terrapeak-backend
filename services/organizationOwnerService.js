import mongoose from "mongoose";

import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import OrganizationOwnerAudit from "../models/organizationOwnerAudit.js";
import User from "../models/user.js";
import { issuePasswordReset } from "./userLifecycleService.js";
import { databaseSupportsTransactions } from "./organizationService.js";

const PLATFORM_ADMIN_ROLES = new Set(["platform-owner", "platform-admin"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 200;

const ownerError = (statusCode, code, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const assertPlatformAdmin = (actor) => {
  if (!PLATFORM_ADMIN_ROLES.has(actor?.platformRole)) {
    throw ownerError(
      403,
      "PLATFORM_ROLE_REQUIRED",
      "Terrapeak Organization administration access is required.",
    );
  }
};

const maskEmail = (email) => {
  const [local = "", domain = ""] = String(email || "").split("@");
  if (!local || !domain) return "";
  const visibleLocal = local.length <= 2 ? local[0] || "*" : local.slice(0, 2);
  return `${visibleLocal}${"*".repeat(Math.max(1, local.length - visibleLocal.length))}@${domain}`;
};

const safeUserSnapshot = (user) => ({
  name: user.name,
  email: maskEmail(user.email),
});

const mutableUserSnapshot = (user) => ({
  name: user.name,
  email: user.email,
  passwordChangedAt: user.passwordChangedAt || null,
  mustChangePassword: user.mustChangePassword === true,
  passwordResetTokenHash: user.passwordResetTokenHash || null,
  passwordResetExpiresAt: user.passwordResetExpiresAt || null,
  passwordResetSentAt: user.passwordResetSentAt || null,
});

const restoreUserSnapshot = (user, snapshot) => {
  user.name = snapshot.name;
  user.email = snapshot.email;
  user.passwordChangedAt = snapshot.passwordChangedAt;
  user.mustChangePassword = snapshot.mustChangePassword;
  user.passwordResetTokenHash = snapshot.passwordResetTokenHash;
  user.passwordResetExpiresAt = snapshot.passwordResetExpiresAt;
  user.passwordResetSentAt = snapshot.passwordResetSentAt;
};

const withSession = (query, session) => (session ? query.session(session) : query);

const resolveActiveOwner = async (organizationId, { session } = {}) => {
  const organization = await withSession(
    Organization.findById(organizationId),
    session,
  );
  if (!organization) {
    throw ownerError(404, "ORGANIZATION_NOT_FOUND", "Organization not found.");
  }

  const membership = await withSession(
    OrganizationMembership.findOne({
      organizationId: organization._id,
      role: "owner",
      status: "active",
    }),
    session,
  );
  if (!membership) {
    throw ownerError(
      404,
      "ORGANIZATION_ACTIVE_OWNER_NOT_FOUND",
      "This Organization does not have an active owner.",
    );
  }

  const user = await withSession(User.findById(membership.userId), session);
  if (!user) {
    throw ownerError(404, "ORGANIZATION_OWNER_USER_NOT_FOUND", "The Organization owner User was not found.");
  }

  return { organization, membership, user };
};

const validateOwnerUpdates = (updates = {}) => {
  const supportedFields = ["name", "email"];
  if (!supportedFields.some((field) => updates[field] !== undefined)) {
    throw ownerError(400, "OWNER_FIELDS_REQUIRED", "Name or email is required.");
  }

  const normalized = {};
  if (updates.name !== undefined) {
    normalized.name = String(updates.name).trim();
    if (!normalized.name) {
      throw ownerError(400, "OWNER_NAME_REQUIRED", "Owner name is required.");
    }
    if (normalized.name.length > MAX_NAME_LENGTH) {
      throw ownerError(400, "OWNER_NAME_TOO_LONG", "Owner name is too long.");
    }
  }

  if (updates.email !== undefined) {
    normalized.email = String(updates.email).trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized.email)) {
      throw ownerError(400, "OWNER_EMAIL_INVALID", "A valid owner email is required.");
    }
  }

  return normalized;
};

const assertEmailAvailable = async ({ email, userId, session }) => {
  const conflict = await withSession(
    User.findOne({ email, _id: { $ne: userId } }).select("_id"),
    session,
  );
  if (conflict) {
    throw ownerError(409, "OWNER_EMAIL_CONFLICT", "This email is already in use.");
  }
};

const createAudit = async ({
  eventType,
  organizationId,
  actor,
  affectedUserId,
  before,
  after,
  session,
}) => {
  const audit = {
    eventType,
    organizationId,
    actorUserId: actor._id,
    actorPlatformRole: actor.platformRole,
    affectedUserId,
    before,
    after,
  };
  if (session) {
    await OrganizationOwnerAudit.create([audit], { session });
  } else {
    await OrganizationOwnerAudit.create(audit);
  }
};

const consistencyError = (cause) => {
  const error = ownerError(
    500,
    "ORGANIZATION_OWNER_CONSISTENCY_FAILURE",
    "The Organization owner change may have partially applied and requires review.",
  );
  error.cause = cause;
  return error;
};

const restoreAfterFailure = async (user, snapshot, originalError) => {
  restoreUserSnapshot(user, snapshot);
  try {
    await user.save();
  } catch (compensationError) {
    throw consistencyError(compensationError);
  }
  throw originalError;
};

export const updateOrganizationOwner = async ({
  actor,
  organizationId,
  updates,
  transactionSupported = databaseSupportsTransactions(),
  issueReset = issuePasswordReset,
}) => {
  assertPlatformAdmin(actor);
  const normalized = validateOwnerUpdates(updates);
  const emailWillChange =
    normalized.email !== undefined && normalized.email !== String((await resolveActiveOwner(organizationId)).user.email).trim().toLowerCase();

  if (transactionSupported && !emailWillChange) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const context = await resolveActiveOwner(organizationId, { session });
        if (normalized.email !== undefined) {
          await assertEmailAvailable({
            email: normalized.email,
            userId: context.user._id,
            session,
          });
        }
        const before = safeUserSnapshot(context.user);
        if (normalized.name !== undefined) context.user.name = normalized.name;
        if (normalized.email !== undefined) context.user.email = normalized.email;
        await context.user.save({ session });
        await createAudit({
          eventType: "organization_owner_details_updated",
          organizationId: context.organization._id,
          actor,
          affectedUserId: context.user._id,
          before,
          after: safeUserSnapshot(context.user),
          session,
        });
        result = context.user;
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  const context = await resolveActiveOwner(organizationId);
  if (normalized.email !== undefined && normalized.email !== context.user.email) {
    await assertEmailAvailable({ email: normalized.email, userId: context.user._id });
  }
  const before = safeUserSnapshot(context.user);
  const snapshot = mutableUserSnapshot(context.user);
  const emailChanged = normalized.email !== undefined && normalized.email !== context.user.email;
  if (normalized.name !== undefined) context.user.name = normalized.name;
  if (emailChanged) {
    context.user.email = normalized.email;
    context.user.passwordChangedAt = new Date();
    context.user.mustChangePassword = true;
  }

  try {
    await context.user.save();
    if (emailChanged) {
      await issueReset({ user: context.user });
    }
    await createAudit({
      eventType: "organization_owner_details_updated",
      organizationId: context.organization._id,
      actor,
      affectedUserId: context.user._id,
      before,
      after: safeUserSnapshot(context.user),
    });
  } catch (error) {
    if (error?.code === 11000) {
      await restoreAfterFailure(
        context.user,
        snapshot,
        ownerError(409, "OWNER_EMAIL_CONFLICT", "This email is already in use."),
      );
    }
    await restoreAfterFailure(context.user, snapshot, error);
  }

  return context.user;
};

export const sendOrganizationOwnerPasswordReset = async ({
  actor,
  organizationId,
  issueReset = issuePasswordReset,
}) => {
  assertPlatformAdmin(actor);
  const context = await resolveActiveOwner(organizationId);
  const snapshot = mutableUserSnapshot(context.user);
  try {
    await issueReset({ user: context.user });
    await createAudit({
      eventType: "organization_owner_password_reset_sent",
      organizationId: context.organization._id,
      actor,
      affectedUserId: context.user._id,
      before: null,
      after: { email: maskEmail(context.user.email) },
    });
  } catch (error) {
    await restoreAfterFailure(context.user, snapshot, error);
  }
  return context.user;
};
