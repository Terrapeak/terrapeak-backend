import Contract from "../models/contract.js";

const DEFAULT_TRIAL_DAYS = 30;

export async function createTrialContract({
  company,
  createdBy,
}) {
  const startDate = new Date();

  const endDate = new Date(startDate);
  endDate.setDate(
    endDate.getDate() + DEFAULT_TRIAL_DAYS
  );

  return Contract.create({
    companyId: company._id,

    plan: company.plan || "starter",

    status: "trial",

    startDate,

    endDate,

    autoRenew: false,

    billingType: "manual",

    createdBy: createdBy?._id || null,

    convertedFromTrial: false,
  });
}