import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import OrganizationMembership from "../models/organizationMembership.js";

export const reconcileOrganizationAccessForCompanyUser = async ({
  companyId,
  userId,
}) => {
  if (!companyId || !userId) return;

  const company = await Company.findById(companyId).select("organizationId");
  if (!company?.organizationId) return;

  const organizationMembership = await OrganizationMembership.findOne({
    organizationId: company.organizationId,
    userId,
  });

  if (!organizationMembership || organizationMembership.role !== "member") return;

  const organizationCompanyIds = await Company.find({
    organizationId: company.organizationId,
  }).distinct("_id");

  const hasActiveCompanyAccess = await CompanyMembership.exists({
    companyId: { $in: organizationCompanyIds },
    userId,
    status: "active",
  });

  organizationMembership.status = hasActiveCompanyAccess ? "active" : "inactive";
  await organizationMembership.save();
};

export default reconcileOrganizationAccessForCompanyUser;
