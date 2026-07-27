import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";
import reconcileOrganizationAccessForCompanyUser from "../services/companyOrganizationAccessService.js";

const MEMBERSHIP_ROLES = new Set(["owner", "admin", "manager", "staff", "viewer"]);
const ACTIVITY_LIMIT = 50;

const appendAdminActivity = async ({ companyId, title, actor, metadata = {} }) => {
  await Company.updateOne(
    { _id: companyId },
    {
      $push: {
        activityEvents: {
          $each: [
            {
              eventType: "updated",
              title,
              appSlug: "platform-admin",
              appName: "Platform Administration",
              actorUserId: actor?._id || null,
              actorName: actor?.name || "",
              actorEmail: actor?.email || "",
              createdAt: new Date(),
              metadata,
            },
          ],
          $position: 0,
          $slice: ACTIVITY_LIMIT,
        },
      },
    },
  );
};

const findReplacementOwner = async (companyId, excludedMembershipId) =>
  CompanyMembership.findOne({
    companyId,
    _id: { $ne: excludedMembershipId },
    role: "owner",
    status: "active",
  }).select("userId");

const ensureOwnerSafeguard = async ({ companyId, membership, nextRole, nextActive }) => {
  const removesOwner =
    membership.role === "owner" &&
    (nextRole !== "owner" || nextActive === false);

  if (!removesOwner) return null;

  const replacementOwner = await findReplacementOwner(companyId, membership._id);
  if (!replacementOwner) {
    const error = new Error("A company must keep at least one active owner.");
    error.statusCode = 409;
    throw error;
  }

  return replacementOwner;
};

export const updatePlatformCompanyUserLifecycle = asyncHandler(async (req, res) => {
  const { companyId, membershipId } = req.params;
  const membership = await CompanyMembership.findOne({
    _id: membershipId,
    companyId,
  });

  if (!membership) {
    return res.status(404).json({ success: false, message: "Company user not found." });
  }

  const user = await User.findById(membership.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: "User record not found." });
  }

  const nextRole = req.body.role ?? membership.role;
  const nextActive = req.body.isActive ?? membership.status === "active";

  if (!MEMBERSHIP_ROLES.has(nextRole)) {
    return res.status(400).json({ success: false, message: "Invalid company role." });
  }

  const replacementOwner = await ensureOwnerSafeguard({
    companyId,
    membership,
    nextRole,
    nextActive,
  });

  if (membership.status !== "active" && nextActive) {
    const company = await Company.findById(companyId).select("maxUsers");
    const activeMemberships = await CompanyMembership.countDocuments({
      companyId,
      status: "active",
    });

    if (activeMemberships >= company.maxUsers) {
      return res.status(409).json({
        success: false,
        message: `This company has reached its maximum of ${company.maxUsers} active users.`,
      });
    }
  }

  membership.role = nextRole;
  membership.status = nextActive ? "active" : "inactive";
  await membership.save();

  if (replacementOwner) {
    await Company.updateOne(
      { _id: companyId },
      { ownerUserId: replacementOwner.userId },
    );
  } else if (nextRole === "owner" && nextActive) {
    await Company.updateOne({ _id: companyId }, { ownerUserId: user._id });
  }

  await reconcileOrganizationAccessForCompanyUser({
    companyId,
    userId: user._id,
  });

  await appendAdminActivity({
    companyId,
    title: nextActive ? "Company user updated" : "Company user suspended",
    actor: req.platformUser,
    metadata: {
      userId: user._id,
      email: user.email,
      role: membership.role,
      status: membership.status,
    },
  });

  res.json({ success: true, user, membership });
});

export const removePlatformCompanyUserLifecycle = asyncHandler(async (req, res) => {
  const { companyId, membershipId } = req.params;
  const membership = await CompanyMembership.findOne({
    _id: membershipId,
    companyId,
  });

  if (!membership) {
    return res.status(404).json({ success: false, message: "Company user not found." });
  }

  const replacementOwner = await ensureOwnerSafeguard({
    companyId,
    membership,
    nextRole: membership.role,
    nextActive: false,
  });

  membership.status = "removed";
  membership.removedAt = new Date();
  membership.removedByUserId = req.userId || null;
  await membership.save();

  if (replacementOwner) {
    await Company.updateOne(
      { _id: companyId },
      { ownerUserId: replacementOwner.userId },
    );
  }

  await reconcileOrganizationAccessForCompanyUser({
    companyId,
    userId: membership.userId,
  });

  const user = await User.findById(membership.userId).select("email");

  await appendAdminActivity({
    companyId,
    title: "Company user removed",
    actor: req.platformUser,
    metadata: {
      userId: membership.userId,
      email: user?.email || "",
      status: membership.status,
    },
  });

  res.json({ success: true, membership });
});
