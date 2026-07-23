import dotenv from "dotenv";
import mongoose from "mongoose";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";

dotenv.config();

const PLATFORM_ROLES = ["platform-owner", "platform-admin"];

const serializeUser = (user) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  platformRole: user.platformRole,
  accountStatus: user.accountStatus,
  isApproved: user.isApproved,
});

const serializeCompany = (company) => ({
  id: String(company._id),
  name: company.name,
  slug: company.slug,
  isPlatformWorkspace: company.isPlatformWorkspace,
  isActive: company.isActive,
  ownerUserId: String(company.ownerUserId),
});

const serializeMembership = (membership) => ({
  id: String(membership._id),
  companyId: String(membership.companyId),
  userId: String(membership.userId),
  role: membership.role,
  status: membership.status,
  isActive: membership.isActive,
});

export const auditPlatformIntegrity = async () => {
  const platformOwners = await User.find({
    platformRole: "platform-owner",
  }).lean();

  const platformUsers = await User.find({
    platformRole: { $in: PLATFORM_ROLES },
  }).lean();

  const activePlatformCompanies = await Company.find({
    isPlatformWorkspace: true,
    isActive: true,
  }).lean();

  const allPlatformCompanies = await Company.find({
    isPlatformWorkspace: true,
  }).lean();

  const activePlatformCompany =
    activePlatformCompanies.length === 1 ? activePlatformCompanies[0] : null;

  const activeMemberships = activePlatformCompany
    ? await CompanyMembership.find({
        companyId: activePlatformCompany._id,
        status: "active",
      }).lean()
    : [];

  const activeMemberIds = new Set(
    activeMemberships.map((membership) => String(membership.userId))
  );

  const missingMembershipUsers = platformUsers.filter(
    (user) => !activeMemberIds.has(String(user._id))
  );

  const unauthorizedMemberships = activeMemberships.filter((membership) => {
    const user = platformUsers.find(
      (candidate) => String(candidate._id) === String(membership.userId)
    );
    return !user;
  });

  const owner = platformOwners.length === 1 ? platformOwners[0] : null;
  const ownerMembership = owner
    ? activeMemberships.find(
        (membership) => String(membership.userId) === String(owner._id)
      )
    : null;

  const checks = [
    {
      id: "exactly_one_platform_owner",
      ok: platformOwners.length === 1,
      count: platformOwners.length,
      samples: platformOwners.map(serializeUser),
    },
    {
      id: "exactly_one_active_platform_workspace",
      ok: activePlatformCompanies.length === 1,
      count: activePlatformCompanies.length,
      samples: activePlatformCompanies.map(serializeCompany),
    },
    {
      id: "no_inactive_platform_workspaces",
      ok: allPlatformCompanies.length === activePlatformCompanies.length,
      count: allPlatformCompanies.length - activePlatformCompanies.length,
      samples: allPlatformCompanies
        .filter((company) => !company.isActive)
        .map(serializeCompany),
    },
    {
      id: "platform_owner_owns_platform_workspace",
      ok:
        Boolean(owner) &&
        Boolean(activePlatformCompany) &&
        String(activePlatformCompany.ownerUserId) === String(owner._id),
      count:
        owner &&
        activePlatformCompany &&
        String(activePlatformCompany.ownerUserId) === String(owner._id)
          ? 0
          : 1,
      samples:
        owner && activePlatformCompany
          ? [
              {
                platformOwnerId: String(owner._id),
                workspaceOwnerUserId: String(activePlatformCompany.ownerUserId),
              },
            ]
          : [],
    },
    {
      id: "platform_owner_has_active_owner_membership",
      ok: Boolean(ownerMembership && ownerMembership.role === "owner"),
      count: ownerMembership && ownerMembership.role === "owner" ? 0 : 1,
      samples: ownerMembership ? [serializeMembership(ownerMembership)] : [],
    },
    {
      id: "all_platform_users_have_active_membership",
      ok: missingMembershipUsers.length === 0,
      count: missingMembershipUsers.length,
      samples: missingMembershipUsers.map(serializeUser),
    },
    {
      id: "no_non_platform_users_in_platform_workspace",
      ok: unauthorizedMemberships.length === 0,
      count: unauthorizedMemberships.length,
      samples: unauthorizedMemberships.map(serializeMembership),
    },
  ];

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
};

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const report = await auditPlatformIntegrity();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        code: "PLATFORM_INTEGRITY_AUDIT_FAILED",
        message: error.message,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
