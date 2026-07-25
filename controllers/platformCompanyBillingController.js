import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import { getCompanyEffectiveBillingHealth } from "../services/platformBillingHealthService.js";

export const getPlatformCompanyEffectiveBilling = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.companyId);

  if (!company) {
    res.status(404);
    throw new Error("Company not found.");
  }

  const effectiveBilling = await getCompanyEffectiveBillingHealth(company);

  res.json({
    success: true,
    companyId: company._id,
    companyName: company.displayName || company.name,
    configuredBillingSource: company.billingSource || "company",
    effectiveBilling,
  });
});
