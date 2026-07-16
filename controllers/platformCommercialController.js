import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import Contract from "../models/contract.js";

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
const CONTRACT_STATUSES = new Set(["trial", "active", "expired", "cancelled"]);
const BILLING_TYPES = new Set(["manual", "invoice", "stripe"]);
const ACTIVITY_LIMIT = 50;

const toDateOrNull = (value) => {
  if (value === null || value === "") return null;
  if (value === undefined) return undefined;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error("One or more supplied dates are invalid.");
    error.statusCode = 400;
    throw error;
  }

  return parsed;
};

const serializeValue = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
};

const buildChanges = (before, after, fields) =>
  fields.reduce((changes, field) => {
    const oldValue = serializeValue(before?.[field]);
    const newValue = serializeValue(after?.[field]);

    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes[field] = { oldValue, newValue };
    }

    return changes;
  }, {});

const appendCommercialActivity = async ({ companyId, actor, changes }) => {
  await Company.updateOne(
    { _id: companyId },
    {
      $push: {
        activityEvents: {
          $each: [
            {
              eventType: "updated",
              title: "Commercial settings updated",
              appSlug: "platform-admin",
              appName: "Platform Administration",
              actorUserId: actor?._id || null,
              actorName: actor?.name || "",
              actorEmail: actor?.email || "",
              createdAt: new Date(),
              metadata: { changes },
            },
          ],
          $position: 0,
          $slice: ACTIVITY_LIMIT,
        },
      },
    }
  );
};

export const updatePlatformCommercialSettings = asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  const company = await Company.findById(companyId);

  if (!company) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  const plan = req.body.plan ?? company.plan;
  const billingStatus = req.body.billingStatus ?? company.billing?.status ?? "not_configured";
  const paymentStatus = req.body.paymentStatus ?? company.billing?.paymentStatus ?? "not_configured";
  const contractStatus = req.body.contractStatus;
  const billingType = req.body.billingType;

  if (!PLANS.has(plan)) {
    return res.status(400).json({ success: false, message: "Invalid plan." });
  }
  if (!BILLING_STATUSES.has(billingStatus)) {
    return res.status(400).json({ success: false, message: "Invalid billing status." });
  }
  if (!PAYMENT_STATUSES.has(paymentStatus)) {
    return res.status(400).json({ success: false, message: "Invalid payment status." });
  }
  if (contractStatus !== undefined && !CONTRACT_STATUSES.has(contractStatus)) {
    return res.status(400).json({ success: false, message: "Invalid contract status." });
  }
  if (billingType !== undefined && !BILLING_TYPES.has(billingType)) {
    return res.status(400).json({ success: false, message: "Invalid billing type." });
  }

  const beforeCompany = {
    plan: company.plan,
    billingStatus: company.billing?.status,
    trialEndDate: company.billing?.trialEndDate,
    renewalDate: company.billing?.renewalDate,
    contractEndDate: company.billing?.contractEndDate,
    creditsRemaining: company.billing?.creditsRemaining,
    paymentStatus: company.billing?.paymentStatus,
  };

  company.plan = plan;
  company.billing.status = billingStatus;
  company.billing.paymentStatus = paymentStatus;

  if (req.body.trialEndDate !== undefined) {
    company.billing.trialEndDate = toDateOrNull(req.body.trialEndDate);
  }
  if (req.body.renewalDate !== undefined) {
    company.billing.renewalDate = toDateOrNull(req.body.renewalDate);
  }
  if (req.body.contractEndDate !== undefined) {
    company.billing.contractEndDate = toDateOrNull(req.body.contractEndDate);
  }
  if (req.body.creditsRemaining !== undefined) {
    const credits = Number(req.body.creditsRemaining);
    if (!Number.isFinite(credits) || credits < 0) {
      return res.status(400).json({
        success: false,
        message: "Credits remaining must be zero or greater.",
      });
    }
    company.billing.creditsRemaining = credits;
  }

  await company.save();

  let contract = await Contract.findOne({ companyId: company._id });
  const beforeContract = contract
    ? {
        plan: contract.plan,
        status: contract.status,
        startDate: contract.startDate,
        endDate: contract.endDate,
        autoRenew: contract.autoRenew,
        billingType: contract.billingType,
      }
    : null;

  if (!contract) {
    const startDate = toDateOrNull(req.body.contractStartDate) || new Date();
    const defaultEndDate = new Date(startDate);
    defaultEndDate.setDate(defaultEndDate.getDate() + 30);

    contract = new Contract({
      companyId: company._id,
      plan,
      status: contractStatus || (billingStatus === "trial" ? "trial" : "active"),
      startDate,
      endDate: toDateOrNull(req.body.contractEndDate) || defaultEndDate,
      autoRenew: Boolean(req.body.autoRenew),
      billingType: billingType || "manual",
      createdBy: req.userId || null,
      convertedFromTrial: billingStatus !== "trial",
    });
  } else {
    contract.plan = plan;
    if (contractStatus !== undefined) contract.status = contractStatus;
    if (req.body.contractStartDate !== undefined) {
      contract.startDate = toDateOrNull(req.body.contractStartDate);
    }
    if (req.body.contractEndDate !== undefined) {
      const endDate = toDateOrNull(req.body.contractEndDate);
      if (!endDate) {
        return res.status(400).json({
          success: false,
          message: "Contract end date is required for an existing contract.",
        });
      }
      contract.endDate = endDate;
    }
    if (req.body.autoRenew !== undefined) contract.autoRenew = Boolean(req.body.autoRenew);
    if (billingType !== undefined) contract.billingType = billingType;
    contract.convertedFromTrial = contract.status !== "trial";
  }

  if (contract.endDate <= contract.startDate) {
    return res.status(400).json({
      success: false,
      message: "Contract end date must be after the start date.",
    });
  }

  await contract.save();

  if (company.billing.contractEndDate?.getTime() !== contract.endDate?.getTime()) {
    company.billing.contractEndDate = contract.endDate;
    await company.save();
  }

  const companyChanges = buildChanges(
    beforeCompany,
    {
      plan: company.plan,
      billingStatus: company.billing.status,
      trialEndDate: company.billing.trialEndDate,
      renewalDate: company.billing.renewalDate,
      contractEndDate: company.billing.contractEndDate,
      creditsRemaining: company.billing.creditsRemaining,
      paymentStatus: company.billing.paymentStatus,
    },
    [
      "plan",
      "billingStatus",
      "trialEndDate",
      "renewalDate",
      "contractEndDate",
      "creditsRemaining",
      "paymentStatus",
    ]
  );

  const contractChanges = buildChanges(
    beforeContract || {},
    {
      plan: contract.plan,
      status: contract.status,
      startDate: contract.startDate,
      endDate: contract.endDate,
      autoRenew: contract.autoRenew,
      billingType: contract.billingType,
    },
    ["plan", "status", "startDate", "endDate", "autoRenew", "billingType"]
  );

  const changes = {
    company: companyChanges,
    contract: contractChanges,
  };

  await appendCommercialActivity({
    companyId: company._id,
    actor: req.platformUser,
    changes,
  });

  res.json({
    success: true,
    company,
    contract,
    billingSummary: {
      plan: company.plan,
      billingStatus: company.billing.status,
      trialEndDate: company.billing.trialEndDate,
      renewalDate: company.billing.renewalDate,
      contractEndDate: company.billing.contractEndDate,
      creditsRemaining: company.billing.creditsRemaining,
      paymentStatus: company.billing.paymentStatus,
    },
    changes,
  });
});
