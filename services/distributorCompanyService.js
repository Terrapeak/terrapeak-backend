import crypto from "node:crypto";

import App from "../models/app.js";
import ChatbotSettings from "../models/chatbotSettings.js";
import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import CompanyMembership from "../models/companyMembership.js";
import Contract from "../models/contract.js";
import FacebookChannelConfig from "../models/facebookChannelConfig.js";
import OrganizationMembership from "../models/organizationMembership.js";
import User from "../models/user.js";
import { createTrialContract } from "./contractService.js";
import { provisionCompany } from "./companyProvisioningService.js";
import { issueInvitation } from "./userLifecycleService.js";
import { OrganizationServiceError } from "./organizationService.js";

const ADMIN_ROLES = new Set(["owner", "admin"]);
const EMPTY_BILLING = {
  status: "not_configured",
  trialEndDate: null,
  renewalDate: null,
  contractEndDate: null,
  creditsRemaining: null,
  paymentStatus: "not_configured",
};

const trialBilling = () => {
  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + 30);
  return {
    ...EMPTY_BILLING,
    status: "trial",
    trialEndDate,
    creditsRemaining: 1000,
  };
};

const fail = (status, code, message) =>
  new OrganizationServiceError(status, code, message);

const slugify = (value = "") =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const referencePrefix = (value = "") =>
  value.split(/\s+/).filter(Boolean).map((word) => word[0]).join("").toUpperCase().slice(0, 5);

const normalizeApps = async (requestedApps) => {
  if (requestedApps !== undefined && !Array.isArray(requestedApps)) {
    throw fail(400, "INVALID_APP_SELECTION", "installedApps must be an array.");
  }

  const apps = await App.find({
    isVisible: true,
    isComingSoon: false,
    allowInstall: { $ne: false },
  }).select("slug isCore requiresAIAssistant dependencies").lean();
  const bySlug = new Map(apps.map((app) => [app.slug, app]));
  const requested = requestedApps || [];
  const invalid = requested.filter((slug) => !bySlug.has(slug));
  if (invalid.length) {
    throw fail(400, "INVALID_APP_SELECTION", `These apps are not available: ${invalid.join(", ")}.`);
  }

  const selected = new Set([
    ...apps.filter((app) => app.isCore).map((app) => app.slug),
    ...requested,
  ]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const slug of [...selected]) {
      const app = bySlug.get(slug);
      for (const dependency of app?.dependencies || []) {
        if (!bySlug.has(dependency)) {
          throw fail(400, "INVALID_APP_SELECTION", `Required app ${dependency} is unavailable.`);
        }
        if (!selected.has(dependency)) {
          selected.add(dependency);
          changed = true;
        }
      }
      if (app?.requiresAIAssistant && bySlug.has("ai-assistant")) {
        if (!selected.has("ai-assistant")) {
          selected.add("ai-assistant");
          changed = true;
        }
      }
    }
  }
  return [...selected];
};

export const cleanupDistributorCompanyCreation = async ({
  company,
  createdUser,
}) => {
  const operations = [];
  if (company?._id) {
    operations.push(
      () => CompanyAppInstallation.deleteMany({ companyId: company._id }),
      () => ChatbotSettings.deleteMany({ companyId: company._id }),
      () => FacebookChannelConfig.deleteMany({ companyId: company._id }),
      () => Contract.deleteMany({ companyId: company._id }),
      () => CompanyMembership.deleteMany({ companyId: company._id }),
      () => Company.deleteOne({ _id: company._id }),
    );
  }
  if (createdUser?._id) operations.push(() => User.deleteOne({ _id: createdUser._id }));
  const results = await Promise.allSettled(
    operations.map((operation) => Promise.resolve().then(operation)),
  );
  return results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
};

export const assertDistributorCompanyAccess = ({ organization, actorMembership }) => {
  if (!organization || organization.status !== "active" || organization.isActive === false) {
    throw fail(403, "ORGANIZATION_INACTIVE", "This Organization is not active.");
  }
  if (organization.organizationType !== "distributor") {
    throw fail(403, "DISTRIBUTOR_ORGANIZATION_REQUIRED", "Only Distributor Organizations can create Customers here.");
  }
  if (!actorMembership || actorMembership.status !== "active" || !ADMIN_ROLES.has(actorMembership.role)) {
    throw fail(403, "ORGANIZATION_ROLE_REQUIRED", "An Organization owner or admin is required.");
  }
};

export const createDistributorCompany = async ({ organization, actorMembership, input = {} }) => {
  assertDistributorCompanyAccess({ organization, actorMembership });

  const owner = input.owner || {};
  const companyInput = input.company || input;
  const email = String(owner.email || "").trim().toLowerCase();
  if (!companyInput.name || !email || !owner.name || !owner.phone) {
    throw fail(400, "CUSTOMER_DETAILS_REQUIRED", "Company name and owner name, email, and phone are required.");
  }

  const companySlug = slugify(companyInput.slug || companyInput.name);
  if (!companySlug) throw fail(400, "INVALID_COMPANY_SLUG", "A valid Company slug is required.");
  const existingCompany = await Company.findOne({ slug: companySlug }).select("_id").lean();
  if (existingCompany) throw fail(409, "COMPANY_SLUG_CONFLICT", "A Company with this slug already exists.");

  if (organization.billing?.maxCompanies !== null && organization.billing?.maxCompanies !== undefined) {
    const companyCount = await Company.countDocuments({
      organizationId: organization._id,
      isPlatformWorkspace: { $ne: true },
    });
    if (companyCount >= organization.billing.maxCompanies) {
      throw fail(409, "MAX_COMPANIES_REACHED", "This Distributor Organization has reached its Company limit.");
    }
  }

  const installedApps = await normalizeApps(input.installedApps);
  let user = await User.findOne({ email });
  let createdUser = null;
  let company = null;

  try {
    if (user?.platformRole && user.platformRole !== "none") {
      throw fail(409, "PLATFORM_USER_NOT_ELIGIBLE", "Platform users cannot become Customer owners.");
    }
    if (!user) {
      user = await User.create({
        name: owner.name.trim(),
        email,
        phone: owner.phone.trim(),
        password: crypto.randomBytes(24).toString("base64url"),
        country: companyInput.country || "PH",
        companyName: companyInput.name.trim(),
        role: "user",
        isAdmin: false,
        platformRole: "none",
        isApproved: true,
        accountStatus: "pending",
      });
      createdUser = user;
    }

    const organizationBilling = organization.billingMode === "organization";
    company = await Company.create({
      name: companyInput.name.trim(),
      displayName: companyInput.displayName?.trim() || companyInput.name.trim(),
      slug: companySlug,
      referencePrefix: companyInput.referencePrefix?.trim() || referencePrefix(companyInput.name),
      country: companyInput.country || "PH",
      address: companyInput.address?.trim() || "",
      website: companyInput.website?.trim() || "",
      email: companyInput.email?.trim().toLowerCase() || "",
      phone: companyInput.phone?.trim() || "",
      reservationBusinessSlug: companySlug,
      reservationTemplate: companyInput.reservationTemplate || "general",
      installedApps: [],
      plan: organization.plan || "starter",
      billingSource: organizationBilling ? "organization" : "company",
      billing: organizationBilling ? EMPTY_BILLING : trialBilling(),
      maxUsers: 1,
      ownerUserId: user._id,
      organizationId: organization._id,
      isActive: true,
      isPlatformWorkspace: false,
    });

    const membership = await CompanyMembership.create({
      companyId: company._id,
      userId: user._id,
      role: "owner",
      status: "active",
    });
    let contract = null;
    if (!organizationBilling) contract = await createTrialContract({ company, createdBy: user });

    const provisioning = await provisionCompany({
      companyId: company._id,
      ownerUserId: user._id,
      mode: "customer",
      requestedAppSlugs: installedApps,
    });
    const provisionedApps = [...new Set([...provisioning.installedApps, ...provisioning.alreadyInstalledApps])];
    company.installedApps = provisionedApps;
    await company.save();

    const invitation = createdUser
      ? await issueInvitation({ user, company, role: "owner" })
      : null;
    return { user, company, membership, contract, invitation, installedApps: provisionedApps };
  } catch (error) {
    const cleanupFailures = await cleanupDistributorCompanyCreation({
      company,
      createdUser,
    });
    if (cleanupFailures.length) error.cleanupFailures = cleanupFailures;
    throw error;
  }
};

export default createDistributorCompany;
