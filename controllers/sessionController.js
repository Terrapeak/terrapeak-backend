import asyncHandler from "express-async-handler";

import ensureOrganizationMembershipsForCompanyUser from "../services/customerWorkspaceMembershipService.js";

const buildDashboardUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  country: user.country,
  companyName: user.companyName,
  isAdmin: user.isAdmin,
  isApproved: user.isApproved,
  role: user.role || "user",
  platformRole: user.platformRole || "none",
  mustChangePassword: user.mustChangePassword === true,
});

const buildPlatformUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  platformRole: user.platformRole,
});

export const getDashboardSession = asyncHandler(async (req, res) => {
  await ensureOrganizationMembershipsForCompanyUser({ userId: req.user._id });

  return res.status(200).json({
    success: true,
    user: buildDashboardUser(req.user),
  });
});

export const getPlatformSession = asyncHandler(async (req, res) => {
  return res.status(200).json({
    success: true,
    platformUser: buildPlatformUser(req.platformUser),
  });
});
