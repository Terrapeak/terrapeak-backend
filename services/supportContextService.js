import App from "../models/app.js";
import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import CompanyMembership from "../models/companyMembership.js";

const PLAN_RANK = {
  demo: 0,
  starter: 1,
  growth: 2,
  business: 2,
  professional: 3,
  pro: 3,
  enterprise: 4,
  custom: 5,
};

const normalizePlan = (plan) => String(plan || "starter").toLowerCase();

const isPlanEligible = (companyPlan, minimumPlan) =>
  (PLAN_RANK[normalizePlan(companyPlan)] ?? 0) >=
  (PLAN_RANK[normalizePlan(minimumPlan)] ?? 0);

const getUnavailableReason = ({ eligible, installation, app, companyPlan }) => {
  if (app.isComingSoon) return "App is marked as coming soon.";
  if (!app.allowInstall) return "App cannot currently be installed.";
  if (!eligible) {
    return `Not included in the ${companyPlan} plan. Minimum required plan: ${app.minimumPlan}.`;
  }
  if (!installation) {
    return "Included in the current plan but not yet activated or configured by Terrapeak.";
  }
  if (!installation.enabled || installation.status === "disabled") {
    return "Included in the current plan but currently disabled by Terrapeak.";
  }
  if (installation.status === "pending") return "Activation or configuration is still pending.";
  if (installation.status === "failed") return "Activation or configuration previously failed and requires Terrapeak review.";
  return "Available.";
};

export const buildSupportCompanyContext = async (companyId) => {
  const [company, apps, installations, activeUserCount] = await Promise.all([
    Company.findById(companyId).lean(),
    App.find({ isVisible: true }).sort({ sortOrder: 1 }).lean(),
    CompanyAppInstallation.find({ companyId }).lean(),
    CompanyMembership.countDocuments({ companyId, isActive: true }),
  ]);

  if (!company) return null;

  const installationMap = new Map(
    installations.map((installation) => [installation.appSlug, installation])
  );

  const appAccess = apps.map((app) => {
    const installation = installationMap.get(app.slug);
    const eligible = isPlanEligible(company.plan, app.minimumPlan);
    const enabled = Boolean(
      installation?.enabled && installation?.status === "active"
    );

    return {
      slug: app.slug,
      name: app.name,
      category: app.category,
      minimumPlan: app.minimumPlan,
      includedInPlan: eligible,
      installed: Boolean(installation),
      enabled,
      status: installation?.status || "not_installed",
      locked: !enabled,
      reason: getUnavailableReason({
        eligible,
        installation,
        app,
        companyPlan: company.plan,
      }),
    };
  });

  return {
    companyName: company.displayName || company.name,
    country: company.country,
    accountStatus: company.isActive ? "active" : "inactive",
    plan: company.plan,
    billingStatus: company.billing?.status || "not_configured",
    paymentStatus: company.billing?.paymentStatus || "not_configured",
    creditsRemaining: company.billing?.creditsRemaining,
    activeUserCount,
    maxUsers: company.maxUsers,
    appAccess,
  };
};
