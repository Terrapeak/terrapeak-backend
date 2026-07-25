import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import Organization from "../models/organization.js";
import { getPlatformBillingHealth } from "../services/platformBillingHealthService.js";

const BILLING_MODES = new Set(["organization", "company"]);
const PLANS = new Set(["starter", "growth", "professional", "enterprise"]);
const BILLING_STATUSES = new Set([
  "not_configured",
  "trial",
  "active",
  "past_due",
  "cancelled",
  "manual",
]);
const PAYMENT_STATUSES = new Set([
  "not_configured",
  "paid",
  "unpaid",
  "past_due",
  "failed",
  "manual",
]);

const parseNullableDate = (value, fieldName) => {
  if (value === null || value === "" || value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${fieldName} must be a valid date.`);
    error.statusCode = 400;
    throw error;
  }
  return date;
};

const parseNullableLimit = (value, fieldName) => {
  if (value === null || value === "" || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    const error = new Error(`${fieldName} must be a positive whole number.`);
    error.statusCode = 400;
    throw error;
  }
  return number;
};

const serializeOrganizationBilling = (organization, companies = []) => ({
  organizationId: organization._id,
  organizationName: organization.name,
  billingMode: organization.billingMode || "company",
  plan: organization.plan || "starter",
  billing: {
    status: organization.billing?.status || "not_configured",
    paymentStatus: organization.billing?.paymentStatus || "not_configured",
    trialEndDate: organization.billing?.trialEndDate || null,
    renewalDate: organization.billing?.renewalDate || null,
    contractEndDate: organization.billing?.contractEndDate || null,
    creditsRemaining: organization.billing?.creditsRemaining ?? null,
    maxUsers: organization.billing?.maxUsers ?? null,
    maxCompanies: organization.billing?.maxCompanies ?? null,
  },
  companies: companies.map((company) => ({
    companyId: company._id,
    name: company.displayName || company.name,
    billingSource: company.billingSource || "company",
    companyBillingStatus: company.billing?.status || "not_configured",
    companyPlan: company.plan || "starter",
  })),
});

export const getPlatformOrganizationBilling = asyncHandler(async (req, res) => {
  const organization = await Organization.findById(req.params.organizationId);
  if (!organization) {
    res.status(404);
    throw new Error("Organization not found.");
  }

  const companies = await Company.find({
    organizationId: organization._id,
    isPlatformWorkspace: { $ne: true },
  })
    .select("name displayName billingSource billing plan")
    .sort({ name: 1 });

  const platformBillingHealth = await getPlatformBillingHealth();
  const organizationId = organization._id.toString();
  const actions = platformBillingHealth.actions.filter(
    (action) => action.organizationId === organizationId,
  );

  res.json({
    success: true,
    organizationBilling: serializeOrganizationBilling(organization, companies),
    actions,
  });
});

export const updatePlatformOrganizationBilling = asyncHandler(async (req, res) => {
  const organization = await Organization.findById(req.params.organizationId);
  if (!organization) {
    res.status(404);
    throw new Error("Organization not found.");
  }

  const {
    billingMode,
    plan,
    billingStatus,
    paymentStatus,
    trialEndDate,
    renewalDate,
    contractEndDate,
    creditsRemaining,
    maxUsers,
    maxCompanies,
    applyToAllCompanies = true,
  } = req.body || {};

  if (!BILLING_MODES.has(billingMode)) {
    res.status(400);
    throw new Error("Billing mode must be organization or company.");
  }
  if (!PLANS.has(plan)) {
    res.status(400);
    throw new Error("A valid Organization plan is required.");
  }
  if (!BILLING_STATUSES.has(billingStatus)) {
    res.status(400);
    throw new Error("A valid billing status is required.");
  }
  if (!PAYMENT_STATUSES.has(paymentStatus)) {
    res.status(400);
    throw new Error("A valid payment status is required.");
  }

  const parsedCredits =
    creditsRemaining === null || creditsRemaining === "" || creditsRemaining === undefined
      ? null
      : Number(creditsRemaining);
  if (parsedCredits !== null && (!Number.isFinite(parsedCredits) || parsedCredits < 0)) {
    res.status(400);
    throw new Error("Credits remaining must be zero or a positive number.");
  }

  organization.billingMode = billingMode;
  organization.plan = plan;
  organization.billing = {
    ...(organization.billing?.toObject?.() || organization.billing || {}),
    status: billingStatus,
    paymentStatus,
    trialEndDate: parseNullableDate(trialEndDate, "Trial end date"),
    renewalDate: parseNullableDate(renewalDate, "Renewal date"),
    contractEndDate: parseNullableDate(contractEndDate, "Contract end date"),
    creditsRemaining: parsedCredits,
    maxUsers: parseNullableLimit(maxUsers, "Maximum users"),
    maxCompanies: parseNullableLimit(maxCompanies, "Maximum Companies"),
  };
  await organization.save();

  if (applyToAllCompanies) {
    await Company.updateMany(
      {
        organizationId: organization._id,
        isPlatformWorkspace: { $ne: true },
      },
      {
        $set: {
          billingSource:
            billingMode === "organization" ? "organization" : "company",
        },
      },
    );
  }

  const companies = await Company.find({
    organizationId: organization._id,
    isPlatformWorkspace: { $ne: true },
  })
    .select("name displayName billingSource billing plan")
    .sort({ name: 1 });

  res.json({
    success: true,
    message:
      billingMode === "organization"
        ? "Organization billing saved and applied to attached Companies."
        : "Individual Company billing saved for attached Companies.",
    organizationBilling: serializeOrganizationBilling(organization, companies),
  });
});
