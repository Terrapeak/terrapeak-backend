import { getAppManifest } from "../appManifests/index.js";
import asyncHandler from "express-async-handler";
import App from "../models/app.js";
import CompanyMembership from "../models/companyMembership.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";

const RESERVATIONS_CUSTOMER_ROUTE = "/dashboard/reservations";

const buildReservationsServiceUrl = (company, installation) => {
  if (!installation?.enabled || !company?.reservationBusinessSlug) return "";

  const baseUrl = String(process.env.RESERVATION_APP_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");

  if (!baseUrl) return "";

  return `${baseUrl}/${company.reservationBusinessSlug}`;
};

export const getMyCompanyApps = asyncHandler(async (req, res) => {
  const company = req.company;

  const apps = await App.find({
    isVisible: true,
  }).sort({ sortOrder: 1 });

  const installations = await CompanyAppInstallation.find({
    companyId: company._id,
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
    const isReservations = app.slug === "reservations";

    return {
      slug: app.slug,
      manifest,
      name: app.name,
      description: app.description,
      category: app.category,
      // launchUrl remains for standalone apps. Reservations is dashboard-owned.
      launchUrl: isReservations ? RESERVATIONS_CUSTOMER_ROUTE : app.launchUrl,
      customerRoute: isReservations ? RESERVATIONS_CUSTOMER_ROUTE : app.launchUrl,
      serviceUrl: isReservations
        ? buildReservationsServiceUrl(company, installation)
        : "",
      isCore: app.isCore,
      isComingSoon: app.isComingSoon,
      installed: Boolean(installation?.enabled),
      status: installation?.status || "locked",
      locked: !installation?.enabled,
    };
  });

  res.json({
    success: true,
    companyId: company._id,
    apps: result,
  });
});

export const getMyCompanies = asyncHandler(async (req, res) => {
  const userId = req.userId;

  const memberships = await CompanyMembership.find({
    userId,
    status: "active",
  }).populate("companyId");

  const companies = memberships
    .filter((membership) => membership.companyId)
    .map((membership) => ({
      companyId: membership.companyId._id,
      organizationId: membership.companyId.organizationId || null,
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
