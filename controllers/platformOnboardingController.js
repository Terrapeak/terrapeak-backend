import asyncHandler from "express-async-handler";

import App from "../models/app.js";
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
  const apps = await App.find({
    isVisible: true,
    isComingSoon: false,
    allowInstall: { $ne: false },
  })
    .select("slug name description category isCore requiresAIAssistant dependencies sortOrder")
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  res.json({
    success: true,
    defaults: {
      country: "PH",
      plan: "starter",
      maxUsers: 1,
    },
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
    plan = "starter",
    maxUsers = 1,
    installedApps = [],
  } = req.body || {};

  if (!ownerName || !ownerEmail || !ownerPhone || !ownerPassword) {
    res.status(400);
    throw new Error("Owner name, email, phone and temporary password are required.");
  }

  if (!companyName) {
    res.status(400);
    throw new Error("Company name is required.");
  }

  const normalizedSlug = companySlug || slugify(companyName);
  const normalizedPrefix = referencePrefix || makeReferencePrefix(companyName);
  const normalizedReservationSlug =
    reservationBusinessSlug || normalizedSlug;

  const availableApps = await App.find({
    isVisible: true,
    isComingSoon: false,
    allowInstall: { $ne: false },
  })
    .select("slug isCore requiresAIAssistant dependencies")
    .lean();

  const availableSlugs = new Set(availableApps.map((app) => app.slug));
  const coreApps = availableApps.filter((app) => app.isCore).map((app) => app.slug);
  const requestedApps = installedApps.filter((slug) => availableSlugs.has(slug));
  const finalApps = new Set([...coreApps, ...requestedApps]);

  let changed = true;
  while (changed) {
    changed = false;

    for (const app of availableApps) {
      if (!finalApps.has(app.slug)) continue;

      if (app.requiresAIAssistant && availableSlugs.has("ai-assistant") && !finalApps.has("ai-assistant")) {
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

  const result = await onboardCustomerEnvironment({
    owner: {
      name: ownerName,
      email: ownerEmail,
      phone: ownerPhone,
      password: ownerPassword,
      country,
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
  });

  res.status(201).json({
    success: true,
    message: "Customer onboarding completed.",
    user: {
      id: result.user._id,
      name: result.user.name,
      email: result.user.email,
    },
    company: {
      id: result.company._id,
      name: result.company.name,
      displayName: result.company.displayName,
      slug: result.company.slug,
      plan: result.company.plan,
      maxUsers: result.company.maxUsers,
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
