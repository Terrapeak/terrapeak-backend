import { getAppManifest } from "../appManifests/index.js";
import asyncHandler from "express-async-handler";
import Company from "../models/company.js";
import App from "../models/app.js";
import CompanyMembership from "../models/companyMembership.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";

export const getMyCompanyApps = asyncHandler(async (req, res) => {
  const userId = req.userId;

  const membership = await CompanyMembership.findOne({
    userId,
    isActive: true,
  });

  if (!membership) {
    return res.status(404).json({
      success: false,
      message: "No active company membership found.",
    });
  }

  const company = await Company.findById(membership.companyId);

if (!company) {
  return res.status(404).json({
    success: false,
    message: "Company not found.",
  });
}

  const apps = await App.find({
    isVisible: true,
  }).sort({ sortOrder: 1 });

  const installations = await CompanyAppInstallation.find({
    companyId: membership.companyId,
  });

  const installedMap = new Map(
    installations.map((installation) => [
      installation.appSlug,
      installation,
    ])
  );

  const result = apps.map((app) => {
    const installation = installedMap.get(app.slug);
    const manifest = getAppManifest(app.slug);

    return {
      slug: app.slug,
      manifest,
      name: app.name,
      description: app.description,
      category: app.category,
      launchUrl:
        app.slug === "reservations" && installation?.enabled
          ? `${process.env.RESERVATION_APP_BASE_URL}/${company.reservationBusinessSlug}/admin`
          : app.launchUrl,
      isCore: app.isCore,
      isComingSoon: app.isComingSoon,
      installed: Boolean(installation?.enabled),
      status: installation?.status || "locked",
      locked: !installation?.enabled,
    };
  });

  res.json({
    success: true,
    companyId: membership.companyId,
    apps: result,
  });
});

export const getMyCompanies = asyncHandler(async (req, res) => {
  const userId = req.userId;

  const memberships = await CompanyMembership.find({
    userId,
    isActive: true,
  }).populate("companyId");

  const companies = memberships
    .filter((membership) => membership.companyId)
    .map((membership) => ({
      companyId: membership.companyId._id,
      name: membership.companyId.name,
      displayName: membership.companyId.displayName,
      slug: membership.companyId.slug,
      role: membership.role,
      isOwner: membership.isOwner || membership.role === "owner",
      installedApps: membership.companyId.installedApps || [],
    }));

  res.json({
    success: true,
    companies,
    activeCompany: companies[0] || null,
  });
});