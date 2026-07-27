import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";

export const listPlatformCompanyUsers = asyncHandler(async (req, res) => {
  const { companyId } = req.params;

  const companyExists = await Company.exists({ _id: companyId });
  if (!companyExists) {
    return res.status(404).json({
      success: false,
      message: "Company not found.",
    });
  }

  const memberships = await CompanyMembership.find({
    companyId,
    status: { $in: ["active", "inactive"] },
  })
    .sort({ status: 1, createdAt: 1 })
    .populate(
      "userId",
      "name email phone role isAdmin platformRole isApproved accountStatus invitationStatus",
    );

  res.json({
    success: true,
    users: memberships.map((membership) => ({
      membershipId: membership._id,
      role: membership.role,
      status: membership.status,
      isActive: membership.status === "active",
      user: membership.userId,
    })),
  });
});
