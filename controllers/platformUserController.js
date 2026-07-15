import asyncHandler from "express-async-handler";

import User from "../models/user.js";
import CompanyMembership from "../models/companyMembership.js";

export const listPlatformUsers = asyncHandler(async (req, res) => {
  const query = (req.query.q || "").trim();

  const userFilter = query
    ? {
        $or: [
          { name: { $regex: query, $options: "i" } },
          { email: { $regex: query, $options: "i" } },
          { companyName: { $regex: query, $options: "i" } },
        ],
      }
    : {};

  const users = await User.find(userFilter)
    .select("name email companyName role platformRole isAdmin isApproved")
    .sort({ name: 1 })
    .lean();

  const memberships = await CompanyMembership.find({
    userId: { $in: users.map((user) => user._id) },
  })
    .populate({
      path: "companyId",
      select: "name displayName slug isActive",
    })
    .sort({ isActive: -1, updatedAt: -1 })
    .lean();

  const membershipsByUser = memberships.reduce((map, membership) => {
    const userId = String(membership.userId);
    if (!map.has(userId)) map.set(userId, []);
    map.get(userId).push(membership);
    return map;
  }, new Map());

  const platformUsers = users.map((user) => {
    const userMemberships = membershipsByUser.get(String(user._id)) || [];
    const activeMembership = userMemberships.find(
      (membership) => membership.isActive && membership.companyId
    );
    const primaryMembership = activeMembership || userMemberships[0];
    const company = primaryMembership?.companyId || null;
    const isPlatformUser = user.platformRole && user.platformRole !== "none";
    const isActive = Boolean(activeMembership) || isPlatformUser;

    return {
      userId: user._id,
      name: user.name,
      email: user.email,
      companyId: company?._id || null,
      companyName:
        company?.displayName || company?.name || user.companyName || "Unassigned",
      companySlug: company?.slug || null,
      role: primaryMembership?.role || user.platformRole || user.role,
      status: isActive ? "active" : "inactive",
      isApproved: Boolean(user.isApproved),
      isPlatformUser,
    };
  });

  res.json({
    success: true,
    summary: {
      totalUsers: platformUsers.length,
      activeUsers: platformUsers.filter((user) => user.status === "active").length,
      inactiveUsers: platformUsers.filter((user) => user.status === "inactive").length,
      assignedUsers: platformUsers.filter((user) => user.companyId).length,
    },
    users: platformUsers,
  });
});
