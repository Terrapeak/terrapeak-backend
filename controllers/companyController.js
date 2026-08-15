import { getAppManifest } from "../appManifests/index.js";
import asyncHandler from "express-async-handler";
import App from "../models/app.js";
import CompanyMembership from "../models/companyMembership.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";

const RESERVATIONS_CUSTOMER_ROUTE = "/dashboard/reservations";

const RESERVATIONS_CAPABILITIES_BY_ROLE = Object.freeze({
  owner: {
    manageApp: true,
    manageSettings: true,
    manageTeam: true,
    manageServices: true,
    manageAvailability: true,
    manageBookings: true,
    manageOwnAvailability: true,
    viewBookings: true,
    viewAnalytics: true,
  },
  admin: {
    manageApp: true,
    manageSettings: true,
    manageTeam: true,
    manageServices: true,
    manageAvailability: true,
    manageBookings: true,
    manageOwnAvailability: true,
    viewBookings: true,
    viewAnalytics: true,
  },
  manager: {
    manageApp: false,
    manageSettings: false,
    manageTeam: false,
    manageServices: true,
    manageAvailability: true,
    manageBookings: true,
    manageOwnAvailability: true,
    viewBookings: true,
    viewAnalytics: true,
  },
  staff: {
    manageApp: false,
    manageSettings: false,
    manageTeam: false,
    manageServices: false,
    manageAvailability: false,
    manageBookings: false,
    manageOwnAvailability: true,
    viewBookings: true,
    viewAnalytics: false,
  },
  viewer: {
    manageApp: false,
    manageSettings: false,
    manageTeam: false,
    manageServices: false,
    manageAvailability: false,
    manageBookings: false,
    manageOwnAvailability: false,
    viewBookings: true,
    viewAnalytics: true,
  },
});

const buildReservationsServiceUrl = (company, installation) => {
  if (
    !installation?.enabled ||
    !company?.reservationBusinessId ||
    !company?.reservationBusinessSlug
  ) {
    return "";
  }

  const baseUrl = String(process.env.RESERVATION_APP_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");

  if (!baseUrl) return "";

  return `${baseUrl}/${company.reservationBusinessSlug}`;
};

export const getMyCompanyApps = asyncHandler(async (req, res) => {
  const company = req.company;
  const companyRole = req.companyMembership?.role || "viewer";

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
    const reservationsMapped = Boolean(
      company.reservationBusinessId && company.reservationBusinessSlug
    );

    return {
      slug: app.slug,
      manifest,
      name: app.name,
      description: app.description,
      category: app.category,
      launchUrl: isReservations ? RESERVATIONS_CUSTOMER_ROUTE : app.launchUrl,
      customerRoute: isReservations ? RESERVATIONS_CUSTOMER_ROUTE : app.launchUrl,
      serviceUrl: isReservations
        ? buildReservationsServiceUrl(company, installation)
        : "",
      reservationBusinessId: isReservations
        ? company.reservationBusinessId || null
        : null,
      reservationBusinessSlug: isReservations
        ? company.reservationBusinessSlug || ""
        : "",
      companyRole: isReservations ? companyRole : null,
      capabilities: isReservations
        ? RESERVATIONS_CAPABILITIES_BY_ROLE[companyRole] ||
          RESERVATIONS_CAPABILITIES_BY_ROLE.viewer
        : null,
      isCore: app.isCore,
      isComingSoon: app.isComingSoon,
      installed: Boolean(installation?.enabled),
      status: installation?.status || "locked",
      locked: !installation?.enabled,
      configurationReady: isReservations
        ? Boolean(installation?.enabled && reservationsMapped)
        : Boolean(installation?.enabled),
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
