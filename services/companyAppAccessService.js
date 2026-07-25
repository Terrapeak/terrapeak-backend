import Organization from "../models/organization.js";
import { isPlatformOwnerCompany } from "../utils/companyIdentity.js";

const BILLING_ENABLED_STATUSES = new Set(["trial", "active", "manual"]);

const PLAN_LEVELS = {
  starter: 1,
  growth: 2,
  professional: 3,
  enterprise: 4,
};

export const resolveEffectiveBilling = async (company) => {
  if (!company) {
    return {
      source: "company",
      organization: null,
      plan: "starter",
      billing: { status: "not_configured", paymentStatus: "not_configured" },
      valid: false,
      issue: "Company billing context is unavailable.",
    };
  }

  if (company.billingSource !== "organization") {
    const billing = company.billing || {};
    return {
      source: "company",
      organization: null,
      plan: company.plan || "starter",
      billing,
      valid: BILLING_ENABLED_STATUSES.has(billing.status),
      issue: BILLING_ENABLED_STATUSES.has(billing.status)
        ? null
        : "Company billing is not active.",
    };
  }

  if (!company.organizationId) {
    return {
      source: "organization",
      organization: null,
      plan: company.plan || "starter",
      billing: { status: "not_configured", paymentStatus: "not_configured" },
      valid: false,
      issue: "Company is set to inherit billing but has no Organization.",
    };
  }

  const organization = await Organization.findById(company.organizationId).lean();

  if (!organization) {
    return {
      source: "organization",
      organization: null,
      plan: company.plan || "starter",
      billing: { status: "not_configured", paymentStatus: "not_configured" },
      valid: false,
      issue: "The billing Organization could not be found.",
    };
  }

  const organizationBillingIsConfigured =
    organization.billingMode === "organization" &&
    BILLING_ENABLED_STATUSES.has(organization.billing?.status);

  return {
    source: "organization",
    organization: {
      id: organization._id,
      name: organization.name,
      slug: organization.slug,
      billingMode: organization.billingMode,
    },
    plan: organization.plan || company.plan || "starter",
    billing: organization.billing || {},
    valid: organizationBillingIsConfigured,
    issue: organizationBillingIsConfigured
      ? null
      : "Organization billing is not active for this Company.",
  };
};

const meetsMinimumPlan = ({ companyPlan, minimumPlan }) => {
  if (!minimumPlan) return true;

  const currentLevel = PLAN_LEVELS[companyPlan] || PLAN_LEVELS.starter;
  const requiredLevel = PLAN_LEVELS[minimumPlan] || PLAN_LEVELS.starter;

  return currentLevel >= requiredLevel;
};

export const canEnableCompanyApp = ({ company, app, effectiveBilling = null }) => {
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

  if (isPlatformOwnerCompany(company)) {
    return {
      allowed: true,
      reason: null,
    };
  }

  const billingContext = effectiveBilling || {
    source: "company",
    plan: company.plan || "starter",
    billing: company.billing || {},
    valid: BILLING_ENABLED_STATUSES.has(company?.billing?.status),
  };

  if (
    !meetsMinimumPlan({
      companyPlan: billingContext.plan,
      minimumPlan: app.minimumPlan,
    })
  ) {
    return {
      allowed: false,
      reason: `This app requires the ${app.minimumPlan || "required"} plan.`,
    };
  }

  if (!app.isCore && !billingContext.valid) {
    return {
      allowed: false,
      reason:
        billingContext.issue ||
        "Billing must be active, in trial, or manually approved before this app can be enabled.",
    };
  }

  return {
    allowed: true,
    reason: null,
  };
};
