import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import OrganizationMembership from "../models/organizationMembership.js";

export const ensureOrganizationMembershipsForCompanyUser = async ({ userId }) => {
  if (!userId) return [];

  const companyMemberships = await CompanyMembership.find({
    userId,
    status: "active",
  })
    .select("companyId")
    .lean();

  if (!companyMemberships.length) return [];

  const companies = await Company.find({
    _id: { $in: companyMemberships.map((membership) => membership.companyId) },
    organizationId: { $ne: null },
    isActive: true,
    isPlatformWorkspace: { $ne: true },
  })
    .select("organizationId")
    .lean();

  const organizationIds = Array.from(
    new Set(
      companies
        .map((company) => company.organizationId?.toString())
        .filter(Boolean),
    ),
  );

  const memberships = [];

  for (const organizationId of organizationIds) {
    let membership = await OrganizationMembership.findOne({
      organizationId,
      userId,
    });

    if (!membership) {
      membership = await OrganizationMembership.create({
        organizationId,
        userId,
        role: "member",
        status: "active",
        isActive: true,
      });
    } else if (membership.status !== "active" || membership.isActive !== true) {
      membership.status = "active";
      membership.isActive = true;
      await membership.save();
    }

    memberships.push(membership);
  }

  return memberships;
};

export default ensureOrganizationMembershipsForCompanyUser;
