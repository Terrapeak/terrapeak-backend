import { isPlatformOwnerCompany } from "../utils/companyIdentity.js";

const BILLING_ENABLED_STATUSES = new Set(["trial", "active", "manual"]);

const PLAN_LEVELS = {
  starter: 1,
  growth: 2,
  professional: 3,
  enterprise: 4,
};

const hasValidBillingAccess = (company) =>
  BILLING_ENABLED_STATUSES.has(company?.billing?.status);

const meetsMinimumPlan = ({ companyPlan, minimumPlan }) => {
  if (!minimumPlan) return true;

  const currentLevel = PLAN_LEVELS[companyPlan] || PLAN_LEVELS.starter;
  const requiredLevel = PLAN_LEVELS[minimumPlan] || PLAN_LEVELS.starter;

  return currentLevel >= requiredLevel;
};

export const canEnableCompanyApp = ({ company, app }) => {
  if (app.isComingSoon) {
    return {
      allowed: false,
      reason: "This app is coming soon.",
    };
  }

  if (app.allowInstall === false) {
    return {
      allowed: false,
      reason: "This app cannot currently be installed.",
    };
  }

  // Terrapeak owns the platform and is not subject to customer billing or plan gates.
  if (isPlatformOwnerCompany(company)) {
    return {
      allowed: true,
      reason: null,
    };
  }

  if (
    !meetsMinimumPlan({
      companyPlan: company.plan,
      minimumPlan: app.minimumPlan,
    })
  ) {
    return {
      allowed: false,
      reason: `This app requires the ${app.minimumPlan || "required"} plan.`,
    };
  }

  /*
   * Core apps form part of the base customer environment.
   * Optional apps require valid billing.
   */
  if (!app.isCore && !hasValidBillingAccess(company)) {
    return {
      allowed: false,
      reason:
        "Billing must be active, in trial, or manually approved before this app can be enabled.",
    };
  }

  return {
    allowed: true,
    reason: null,
  };
};
