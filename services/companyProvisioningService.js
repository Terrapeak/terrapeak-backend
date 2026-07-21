import mongoose from "mongoose";
import APP_REGISTRY_DEFINITIONS from "../appRegistryDefinitions.js";
import installApps, { hasAppInstaller } from "../installers/installApps.js";
import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import { canEnableCompanyApp } from "./companyAppAccessService.js";
import { isPlatformOwnerCompany } from "../utils/companyIdentity.js";
import { getReservationsProvisioningHealth } from "../provisioners/reservationProvisioner.js";

const MODES = new Set(["customer", "platform-workspace"]);

const registryBySlug = new Map(
  APP_REGISTRY_DEFINITIONS.map((definition) => [definition.slug, definition])
);

export const appProvisioningHealthChecks = {
  reservations: getReservationsProvisioningHealth,
};

const uniqueSlugs = (values = []) =>
  Array.from(
    new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  );

const isPlatformWorkspace = (company) =>
  company.isPlatformWorkspace === true || isPlatformOwnerCompany(company);

const getPolicyFailure = ({ company, definition, mode }) => {
  if (definition.isComingSoon) {
    return "This app is coming soon.";
  }

  if (definition.allowInstall === false) {
    return "This app cannot currently be installed.";
  }

  if (!hasAppInstaller(definition.slug)) {
    return "No technical installer is available.";
  }

  if (mode === "platform-workspace") return null;

  if (definition.isVisible === false) {
    return "This app is not available to customers.";
  }

  const access = canEnableCompanyApp({ company, app: definition });
  return access.allowed ? null : access.reason;
};

const resolveApps = ({ company, mode, requestedApps, warnings }) => {
  const resolved = [];
  const resolvedSet = new Set();
  const skippedSet = new Set();
  const resolving = new Set();

  const skip = (slug, reason) => {
    skippedSet.add(slug);
    warnings.push(`${slug}: ${reason}`);
    return false;
  };

  const visit = (slug) => {
    if (resolvedSet.has(slug)) return true;
    if (skippedSet.has(slug)) return false;

    const definition = registryBySlug.get(slug);
    if (!definition) return skip(slug, "App is not registered.");

    const policyFailure = getPolicyFailure({ company, definition, mode });
    if (policyFailure) return skip(slug, policyFailure);

    if (resolving.has(slug)) {
      return skip(slug, "A dependency cycle was detected.");
    }

    resolving.add(slug);

    for (const dependency of definition.dependencies || []) {
      if (!visit(dependency)) {
        resolving.delete(slug);
        return skip(slug, `Required dependency ${dependency} is unavailable.`);
      }
    }

    resolving.delete(slug);
    resolvedSet.add(slug);
    resolved.push(slug);
    return true;
  };

  requestedApps.forEach(visit);

  return {
    resolved,
    skipped: Array.from(skippedSet),
  };
};

export const provisionCompany = async ({
  companyId,
  ownerUserId = null,
  mode = "customer",
  requestedAppSlugs = null,
} = {}) => {
  if (!companyId || !mongoose.isValidObjectId(companyId)) {
    throw new Error("A valid companyId is required.");
  }

  const company = await Company.findById(companyId);
  if (!company) throw new Error("Company not found.");

  if (!MODES.has(mode)) {
    throw new Error(`Unsupported provisioning mode: ${mode}.`);
  }

  if (mode === "platform-workspace" && !isPlatformWorkspace(company)) {
    throw new Error(
      "Platform Workspace provisioning requires the Terrapeak Platform Workspace."
    );
  }

  if (mode === "customer" && isPlatformWorkspace(company)) {
    throw new Error(
      "The Terrapeak Platform Workspace must use platform-workspace provisioning mode."
    );
  }

  if (requestedAppSlugs !== null && !Array.isArray(requestedAppSlugs)) {
    throw new Error("requestedAppSlugs must be an array or null.");
  }

  const requestedApps =
    requestedAppSlugs === null
      ? mode === "platform-workspace"
        ? APP_REGISTRY_DEFINITIONS.filter(
            (definition) =>
              !definition.isComingSoon &&
              definition.allowInstall !== false &&
              hasAppInstaller(definition.slug)
          ).map((definition) => definition.slug)
        : APP_REGISTRY_DEFINITIONS.filter(
            (definition) => definition.defaultForCustomer === true
          ).map((definition) => definition.slug)
      : uniqueSlugs(requestedAppSlugs);
  const warnings = [];
  const { resolved, skipped } = resolveApps({
    company,
    mode,
    requestedApps,
    warnings,
  });
  const existingInstallations = resolved.length
    ? await CompanyAppInstallation.find({
        companyId: company._id,
        appSlug: { $in: resolved },
      })
        .select("appSlug enabled status")
        .lean()
    : [];
  const activeSlugs = new Set(
    existingInstallations
      .filter(
        (installation) =>
          installation.enabled && installation.status === "active"
      )
      .map((installation) => installation.appSlug)
  );
  const alreadyInstalledApps = [];
  const appsToInstall = [];
  const repairedApps = [];

  for (const slug of resolved) {
    if (!activeSlugs.has(slug)) {
      appsToInstall.push(slug);
      continue;
    }

    const healthCheck = appProvisioningHealthChecks[slug];
    if (!healthCheck) {
      alreadyInstalledApps.push(slug);
      continue;
    }

    const health = await healthCheck({ company });
    if (health.healthy) {
      alreadyInstalledApps.push(slug);
    } else {
      repairedApps.push(slug);
      warnings.push(
        `${slug}: repairing missing or stale provisioning configuration.`
      );
    }
  }

  const appsToRun = [...appsToInstall, ...repairedApps];
  const effectiveOwnerUserId = ownerUserId || company.ownerUserId;

  if (appsToRun.length && !effectiveOwnerUserId) {
    throw new Error("An owner user is required to provision company apps.");
  }

  if (appsToRun.length) {
    await installApps({
      company,
      user: { _id: effectiveOwnerUserId },
      installedApps: appsToRun,
    });
  }

  const synchronizedLegacyApps = Array.from(
    new Set([...(company.installedApps || []), ...resolved])
  );
  if (synchronizedLegacyApps.length !== (company.installedApps || []).length) {
    company.installedApps = synchronizedLegacyApps;
    await company.save();
  }

  return {
    companyId: company._id,
    mode,
    requestedApps,
    installedApps: appsToInstall,
    repairedApps,
    alreadyInstalledApps,
    skippedApps: skipped,
    warnings,
  };
};

export default provisionCompany;
