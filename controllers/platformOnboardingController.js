import asyncHandler from "express-async-handler";

import App from "../models/app.js";
import Company from "../models/company.js";
import Organization from "../models/organization.js";
import User from "../models/user.js";
import onboardCustomerEnvironment from "../services/customerOnboardingService.js";

const slugify = (text = "") =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const makeReferencePrefix = (companyName = "") =>
  companyName
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 5);

export const getPlatformOnboardingOptions = asyncHandler(async (req, res) => {
  const [apps, organizations] = await Promise.all([
    App.find({
      isVisible: true,
      isComingSoon: false,
      allowInstall: { $ne: false },
    })
      .select(
        "slug name description category isCore requiresAIAssistant dependencies sortOrder",
      )
      .sort({ sortOrder: 1, name: 1 })
      .lean(),
    Organization.find({
      status: "active",
      isActive: true,
    })
      .select("name slug billingMode plan billing.status billing.paymentStatus")
      .sort({ name: 1 })
      .lean(),
  ]);

  res.json({
    success: true,
    defaults: {
      country: "PH",
      plan: "starter",
      maxUsers: 1,
      organizationMode: "create",
      billingMode: "company",
    },
    organizations: organizations.map((organization) => ({
      id: organization._id,
      name: organization.name,
      slug: organization.slug,
      billingMode: organization.billingMode || "company",
      plan: organization.plan || "starter",
      billingStatus: organization.billing?.status || "not_configured",
      paymentStatus:
        organization.billing?.paymentStatus || "not_configured",
    })),
    apps,
  });
});

export const onboardPlatformCustomer = asyncHandler(async (req, res) => {
  const {
    ownerName,
    ownerEmail,
    ownerPhone,
    ownerPassword,
    country = "PH",
    companyName,
    displayName,
    companySlug,
    referencePrefix,
    reservationBusinessSlug,
    companyAddress,
    companyWebsite,
    companyEmail,
    companyPhone,
    plan = "starter",
    maxUsers = 1,
    installedApps = [],
    organizationMode = "create",
    organizationId = null,
    organizationName = "",
    organizationSlug = "",
    billingMode = "company",
  } = req.body || {};

  if (!ownerName || !ownerEmail || !ownerPhone || !ownerPassword) {
    res.status(400);
    throw new Error(
      "Owner name, email, phone and temporary password are required.",
    );
  }

  if (!companyName || !companyAddress || !companyEmail || !companyPhone) {
    res.status(400);
    throw new Error("Company name, address, email and phone are required.");
  }

  if (!["create", "existing"].includes(organizationMode)) {
    res.status(400);
    throw new Error("Organization mode must be create or existing.");
  }

  if (!["organization", "company"].includes(billingMode)) {
    res.status(400);
    throw new Error("Billing mode must be organization or company.");
  }

  if (organizationMode === "existing" && !organizationId) {
    res.status(400);
    throw new Error("Select an existing Organization.");
  }

  const normalizedOwnerEmail = ownerEmail.toLowerCase().trim();
  const ownerAlreadyExisted = Boolean(
    await User.exists({ email: normalizedOwnerEmail }),
  );
  const normalizedSlug = companySlug || slugify(companyName);
  const normalizedPrefix = referencePrefix || makeReferencePrefix(companyName);
  const normalizedReservationSlug =
    reservationBusinessSlug || normalizedSlug;
  const normalizedOrganizationName =
    organizationName?.trim() || companyName.trim();
  const normalizedOrganizationSlug =
    organizationSlug || `${slugify(normalizedOrganizationName)}-organization`;

  const availableApps = await App.find({
    isVisible: true,
    isComingSoon: false,
    allowInstall: { $ne: false },
  })
    .select("slug isCore requiresAIAssistant dependencies")
    .lean();

  const availableSlugs = new Set(availableApps.map((app) => app.slug));
  const coreApps = availableApps
    .filter((app) => app.isCore)
    .map((app) => app.slug);
  const requestedApps = installedApps.filter((slug) =>
    availableSlugs.has(slug),
  );
  const finalApps = new Set([...coreApps, ...requestedApps]);

  let changed = true;
  while (changed) {
    changed = false;

    for (const app of availableApps) {
      if (!finalApps.has(app.slug)) continue;

      if (
        app.requiresAIAssistant &&
        availableSlugs.has("ai-assistant") &&
        !finalApps.has("ai-assistant")
      ) {
        finalApps.add("ai-assistant");
        changed = true;
      }

      for (const dependency of app.dependencies || []) {
        if (availableSlugs.has(dependency) && !finalApps.has(dependency)) {
          finalApps.add(dependency);
          changed = true;
        }
      }
    }
  }

  const onboardingInput = {
    owner: {
      name: ownerName,
      email: normalizedOwnerEmail,
      phone: ownerPhone,
      password: ownerPassword,
      country,
    },
    organization: {
      mode: organizationMode,
      id: organizationMode === "existing" ? organizationId : null,
      name:
        organizationMode === "create" ? normalizedOrganizationName : null,
      slug:
        organizationMode === "create" ? normalizedOrganizationSlug : null,
    },
    billing: {
      mode: billingMode,
    },
    company: {
      name: companyName,
      displayName: displayName || companyName,
      slug: normalizedSlug,
      referencePrefix: normalizedPrefix,
      reservationBusinessSlug: normalizedReservationSlug,
      plan,
      maxUsers: Number(maxUsers) || 1,
    },
    installedApps: Array.from(finalApps),
  };

  let result;
  let resumedPartialOnboarding = false;

  try {
    result = await onboardCustomerEnvironment(onboardingInput);
  } catch (firstError) {
    const partialCompany = await Company.findOne({ slug: normalizedSlug })
      .select("_id")
      .lean();

    if (!partialCompany) {
      throw firstError;
    }

    resumedPartialOnboarding = true;
    console.warn(
      `Customer onboarding for ${normalizedSlug} failed after creating records. Resuming once automatically.`,
      firstError,
    );
    result = await onboardCustomerEnvironment(onboardingInput);
  }

  if (!ownerAlreadyExisted && result.user.mustChangePassword !== true) {
    result.user.mustChangePassword = true;
    await result.user.save();
  }

  result.company.country = country;
  result.company.address = companyAddress.trim();
  result.company.website = companyWebsite?.trim() || "";
  result.company.email = companyEmail.toLowerCase().trim();
  result.company.phone = companyPhone.trim();
  await result.company.save();

  res.status(201).json({
    success: true,
    message: resumedPartialOnboarding
      ? "Customer onboarding completed after automatically resuming a partial setup."
      : "Customer onboarding completed.",
    resumedPartialOnboarding,
    organizationMode: result.organizationMode,
    billingMode: result.billingMode,
    user: {
      id: result.user._id,
      name: result.user.name,
      email: result.user.email,
      mustChangePassword: result.user.mustChangePassword === true,
    },
    organization: {
      id: result.organization._id,
      name: result.organization.name,
      slug: result.organization.slug,
      billingMode: result.organization.billingMode,
      plan: result.organization.plan,
      billingStatus:
        result.organization.billing?.status || "not_configured",
    },
    company: {
      id: result.company._id,
      name: result.company.name,
      displayName: result.company.displayName,
      slug: result.company.slug,
      plan: result.company.plan,
      billingSource: result.company.billingSource,
      maxUsers: result.company.maxUsers,
      country: result.company.country,
      address: result.company.address,
      website: result.company.website,
      email: result.company.email,
      phone: result.company.phone,
    },
    contract: result.contract
      ? {
          id: result.contract._id,
          status: result.contract.status,
          endDate: result.contract.endDate,
        }
      : null,
    installedApps: result.installedApps,
    chatbot: result.chatbotSettings
      ? {
          id: result.chatbotSettings._id,
          apiKey: result.chatbotSettings.apiKey,
        }
      : null,
    validation: result.validation,
  });
});
