import crypto from "crypto";
import mongoose from "mongoose";

import OrganizationMembership from "../models/organizationMembership.js";
import OrganizationOwnerAudit from "../models/organizationOwnerAudit.js";
import Organization from "../models/organization.js";
import User from "../models/user.js";
import { issuePasswordReset } from "./userLifecycleService.js";
import {
  databaseSupportsTransactions,
} from "./organizationService.js";
import {
  ORGANIZATION_OWNER_INTEGRITY,
  organizationOwnerIntegrityError,
  resolveOrganizationOwnerIntegrity,
} from "./organizationOwnerIntegrityService.js";

const PLATFORM_ADMIN_ROLES = new Set(["platform-owner", "platform-admin"]);
const ELIGIBLE_MEMBER_ROLES = new Set(["admin", "manager", "member"]);
const FORMER_OWNER_ACTIONS = new Set(["admin", "member", "remove"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const transferError = (statusCode, code, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const assertPlatformAdmin = (actor) => {
  if (!PLATFORM_ADMIN_ROLES.has(actor?.platformRole)) {
    throw transferError(
      403,
      "PLATFORM_ROLE_REQUIRED",
      "Terrapeak Organization administration access is required.",
    );
  }
};

const withSession = (query, session) => (session ? query.session(session) : query);

const safeId = (value) => value?._id || value;

const membershipSnapshot = (membership) => ({
  membershipId: safeId(membership),
  organizationId: safeId(membership.organizationId),
  userId: safeId(membership.userId),
  role: membership.role,
  status: membership.status,
});

const userSnapshot = (user) => ({
  userId: safeId(user),
  name: user.name,
  email: user.email,
});

const validateUserEligibility = (user) => {
  if (!user) {
    throw transferError(404, "USER_NOT_FOUND", "User not found.");
  }
  if (user.platformRole && user.platformRole !== "none") {
    throw transferError(
      409,
      "ORGANIZATION_USER_INELIGIBLE",
      "Platform users cannot become Organization owners.",
    );
  }
  if (!user.isApproved || user.accountStatus !== "active") {
    throw transferError(
      409,
      "ORGANIZATION_USER_INELIGIBLE",
      "The user account is not eligible to become an Organization owner.",
    );
  }
  if (["pending", "expired"].includes(user.invitationStatus)) {
    throw transferError(
      409,
      "ORGANIZATION_USER_INELIGIBLE",
      "The user account invitation is not active.",
    );
  }
};

const loadUser = async (userId, session) =>
  withSession(
    User.findById(userId).select(
      "_id name email phone platformRole isApproved accountStatus invitationStatus",
    ),
    session,
  );

const validateExistingMember = async ({
  organizationId,
  userId,
  currentOwnerUserId,
  session,
}) => {
  if (String(userId) === String(currentOwnerUserId)) {
    throw transferError(
      409,
      "ORGANIZATION_OWNER_CANDIDATE_INVALID",
      "The current owner cannot be selected as the replacement owner.",
    );
  }

  const [user, membership] = await Promise.all([
    loadUser(userId, session),
    withSession(
      OrganizationMembership.findOne({
        organizationId,
        userId,
        status: "active",
      }),
      session,
    ),
  ]);
  validateUserEligibility(user);
  if (!membership || !ELIGIBLE_MEMBER_ROLES.has(membership.role)) {
    throw transferError(
      409,
      "ORGANIZATION_OWNER_CANDIDATE_INVALID",
      "The replacement user must be an eligible active Organization member.",
    );
  }
  return { user, membership, createdUser: false };
};

const normalizeNewUserInput = (input) => {
  const unknownFields = Object.keys(input || {}).filter(
    (field) => !["mode", "name", "email", "phone"].includes(field),
  );
  if (unknownFields.length) {
    throw transferError(400, "OWNER_TARGET_FIELDS_INVALID", "The new user fields are invalid.");
  }
  const name = String(input?.name || "").trim();
  const email = String(input?.email || "").trim().toLowerCase();
  const phone = String(input?.phone || "").trim();
  if (!name) throw transferError(400, "OWNER_NAME_REQUIRED", "Name is required.");
  if (!email || !EMAIL_PATTERN.test(email)) {
    throw transferError(400, "OWNER_EMAIL_INVALID", "A valid email is required.");
  }
  if (!phone) throw transferError(400, "OWNER_PHONE_REQUIRED", "Phone is required.");
  return { name, email, phone };
};

const resolveNewUser = async ({
  organization,
  input,
  currentOwnerUserId,
  actor,
  session,
}) => {
  const normalized = normalizeNewUserInput(input);
  let user = await withSession(User.findOne({ email: normalized.email }), session);
  let createdUser = false;

  if (!user) {
    user = new User({
      ...normalized,
      password: crypto.randomBytes(32).toString("hex"),
      companyName: organization.name,
      role: "user",
      isAdmin: false,
      platformRole: "none",
      isApproved: true,
      accountStatus: "active",
      invitationStatus: "not_invited",
      mustChangePassword: true,
    });
    await user.save({ session });
    createdUser = true;
  } else {
    validateUserEligibility(user);
    if (String(user._id) === String(currentOwnerUserId)) {
      throw transferError(
        409,
        "ORGANIZATION_OWNER_CANDIDATE_INVALID",
        "The current owner cannot be selected as the replacement owner.",
      );
    }
  }

  let membership = await withSession(
    OrganizationMembership.findOne({
      organizationId: organization._id,
      userId: user._id,
    }),
    session,
  );
  if (membership && (membership.status !== "active" || !ELIGIBLE_MEMBER_ROLES.has(membership.role))) {
    throw transferError(
      409,
      "ORGANIZATION_OWNER_CANDIDATE_INVALID",
      "The existing Organization membership is not eligible for ownership transfer.",
    );
  }
  if (!membership) {
    membership = new OrganizationMembership({
      organizationId: organization._id,
      userId: user._id,
      role: "member",
      status: "active",
      invitedByUserId: actor._id,
    });
    await membership.save({ session });
  }
  return { user, membership, createdUser };
};

const resolveTarget = async ({
  organization,
  newOwner,
  currentOwnerUserId,
  actor,
  session,
}) => {
  if (!newOwner || typeof newOwner !== "object") {
    throw transferError(400, "OWNER_TARGET_REQUIRED", "A new owner is required.");
  }
  if (newOwner.mode === "existing_member") {
    const unknownFields = Object.keys(newOwner).filter(
      (field) => !["mode", "userId"].includes(field),
    );
    if (unknownFields.length) {
      throw transferError(400, "OWNER_TARGET_FIELDS_INVALID", "The replacement member fields are invalid.");
    }
    if (!newOwner.userId) {
      throw transferError(400, "OWNER_USER_REQUIRED", "A replacement User is required.");
    }
    return validateExistingMember({
      organizationId: organization._id,
      userId: newOwner.userId,
      currentOwnerUserId,
      session,
    });
  }
  if (newOwner.mode === "new_user") {
    return resolveNewUser({
      organization,
      input: newOwner,
      currentOwnerUserId,
      actor,
      session,
    });
  }
  throw transferError(400, "OWNER_TARGET_MODE_INVALID", "The new owner mode is invalid.");
};

const assertFormerOwnerAction = (action) => {
  if (!FORMER_OWNER_ACTIONS.has(action)) {
    throw transferError(
      400,
      "FORMER_OWNER_ACTION_REQUIRED",
      "Choose what happens to the former owner.",
    );
  }
};

const updateTransferVersion = async (organization, session, expected) => {
  // The Organization-scoped compare-and-swap serializes transfers inside the
  // transaction. The first transaction that advances this version wins;
  // another concurrent transaction is forced to abort and retry from fresh
  // ownership state.
  const result = await Organization.updateOne(
    {
      _id: organization._id,
      $or: [
        { ownerTransferVersion: expected },
        ...(expected === 0 ? [{ ownerTransferVersion: { $exists: false } }] : []),
      ],
    },
    { $inc: { ownerTransferVersion: 1 } },
    { session },
  );
  if (result.matchedCount !== 1) {
    throw transferError(
      409,
      "ORGANIZATION_OWNER_TRANSFER_CONFLICT",
      "Another owner transfer changed this Organization. Please reload and try again.",
    );
  }
};

export const listEligibleOrganizationOwnerCandidates = async ({
  actor,
  organizationId,
}) => {
  assertPlatformAdmin(actor);
  const organization = await Organization.findById(organizationId);
  if (!organization) throw transferError(404, "ORGANIZATION_NOT_FOUND", "Organization not found.");
  const integrity = await resolveOrganizationOwnerIntegrity({ organizationId: organization._id });
  if (integrity.status !== ORGANIZATION_OWNER_INTEGRITY.VALID) {
    return [];
  }
  const memberships = await OrganizationMembership.find({
    organizationId: organization._id,
    status: "active",
    role: { $in: [...ELIGIBLE_MEMBER_ROLES] },
    userId: { $ne: integrity.ownerMembership.userId },
  }).populate("userId", "_id name email platformRole isApproved accountStatus invitationStatus");
  return memberships
    .filter((membership) => {
      try {
        validateUserEligibility(membership.userId);
        return true;
      } catch {
        return false;
      }
    })
    .map((membership) => ({
      userId: membership.userId._id,
      name: membership.userId.name,
      email: membership.userId.email,
      role: membership.role,
      status: membership.status,
    }));
};

export const transferOrganizationOwner = async ({
  actor,
  organizationId,
  newOwner,
  formerOwnerAction,
  transactionSupported = databaseSupportsTransactions(),
  startSession = () => mongoose.startSession(),
  issueReset = issuePasswordReset,
}) => {
  assertPlatformAdmin(actor);
  assertFormerOwnerAction(formerOwnerAction);
  if (!transactionSupported) {
    throw transferError(
      503,
      "ORGANIZATION_OWNER_TRANSFER_REQUIRES_TRANSACTION",
      "Owner transfer requires a transactional MongoDB connection.",
    );
  }

  const initialOrganization = await Organization.findById(organizationId).select(
    "_id ownerTransferVersion",
  );
  if (!initialOrganization) {
    throw transferError(404, "ORGANIZATION_NOT_FOUND", "Organization not found.");
  }
  const initialTransferVersion = initialOrganization.ownerTransferVersion || 0;
  const session = await startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const organization = await Organization.findById(organizationId).session(session);
      if (!organization) throw transferError(404, "ORGANIZATION_NOT_FOUND", "Organization not found.");
      if ((organization.ownerTransferVersion || 0) !== initialTransferVersion) {
        throw transferError(
          409,
          "ORGANIZATION_OWNER_TRANSFER_CONFLICT",
          "Another owner transfer changed this Organization. Please reload and try again.",
        );
      }
      const integrity = await resolveOrganizationOwnerIntegrity({
        organizationId: organization._id,
        session,
      });
      if (integrity.status === ORGANIZATION_OWNER_INTEGRITY.OWNERLESS) {
        throw transferError(409, "ORGANIZATION_OWNER_REQUIRED", "This Organization does not have an active owner.");
      }
      if (integrity.status === ORGANIZATION_OWNER_INTEGRITY.MULTIPLE_OWNERS) {
        throw organizationOwnerIntegrityError(
          "This Organization has multiple active owners and requires integrity review.",
        );
      }

      const currentOwnerMembership = integrity.ownerMembership;
      const currentOwner = await loadUser(currentOwnerMembership.userId, session);
      validateUserEligibility(currentOwner);
      const target = await resolveTarget({
        organization,
        newOwner,
        currentOwnerUserId: currentOwner._id,
        actor,
        session,
      });
      if (String(target.user._id) === String(currentOwner._id)) {
        throw transferError(409, "ORGANIZATION_OWNER_CANDIDATE_INVALID", "The current owner cannot be selected as the replacement owner.");
      }

      await updateTransferVersion(organization, session, initialTransferVersion);

      const before = {
        owner: userSnapshot(currentOwner),
        membership: membershipSnapshot(currentOwnerMembership),
      };

      target.membership.role = "owner";
      target.membership.status = "active";
      await target.membership.save({ session });

      currentOwnerMembership.role = formerOwnerAction === "remove" ? "member" : formerOwnerAction;
      currentOwnerMembership.status = formerOwnerAction === "remove" ? "removed" : "active";
      await currentOwnerMembership.save({ session });

      const after = {
        owner: userSnapshot(target.user),
        membership: membershipSnapshot(target.membership),
        formerOwner: {
          user: userSnapshot(currentOwner),
          membership: membershipSnapshot(currentOwnerMembership),
        },
      };
      await OrganizationOwnerAudit.create([{
        eventType: "organization_owner_transferred",
        organizationId: organization._id,
        actorUserId: actor._id,
        actorPlatformRole: actor.platformRole,
        affectedUserId: target.user._id,
        formerOwnerUserId: currentOwner._id,
        newOwnerUserId: target.user._id,
        formerOwnerAction,
        before,
        after,
      }], { session });

      result = {
        organization,
        ownerMembership: target.membership,
        ownerUser: target.user,
        formerOwnerMembership: currentOwnerMembership,
        formerOwnerUser: currentOwner,
        newUserCreated: target.createdUser,
      };
    });
  } finally {
    await session.endSession();
  }

  let notificationSent = null;
  let notificationPending = false;
  if (result.newUserCreated) {
    result.ownerUser.$session?.(null);
    try {
      await issueReset({ user: result.ownerUser });
      notificationSent = true;
    } catch {
      notificationSent = false;
      notificationPending = true;
    }
  }

  return {
    ...result,
    notificationSent,
    notificationPending,
  };
};
