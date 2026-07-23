import mongoose from "mongoose";

import CompanyMembership from "../models/companyMembership.js";
import isAuthenticated from "./isAuthenticated.js";

const attachCompanyContext = async (req, res, next) => {
  const requestedCompanyId = String(req.get("x-company-id") || "").trim();

  if (
    requestedCompanyId &&
    !mongoose.Types.ObjectId.isValid(requestedCompanyId)
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_COMPANY_CONTEXT",
      message: "The selected company is invalid.",
    });
  }

  const membershipFilter = {
    userId: req.userId,
    isActive: true,
    status: { $ne: "removed" },
    ...(requestedCompanyId ? { companyId: requestedCompanyId } : {}),
  };

  const memberships = await CompanyMembership.find(membershipFilter).populate({
    path: "companyId",
    match: {
      isActive: true,
      isPlatformWorkspace: { $ne: true },
    },
  });

  const activeMemberships = memberships.filter(
    (membership) => membership.companyId
  );

  if (requestedCompanyId && !activeMemberships.length) {
    return res.status(403).json({
      success: false,
      code: "COMPANY_ACCESS_DENIED",
      message: "You do not have active access to the selected company.",
    });
  }

  if (!activeMemberships.length) {
    return res.status(404).json({
      success: false,
      code: "COMPANY_CONTEXT_NOT_FOUND",
      message: "No active customer company membership was found.",
    });
  }

  if (activeMemberships.length > 1) {
    return res.status(409).json({
      success: false,
      code: "COMPANY_CONTEXT_REQUIRED",
      message: "Select a company using the x-company-id header.",
    });
  }

  const companyMembership = activeMemberships[0];

  req.companyMembership = companyMembership;
  req.company = companyMembership.companyId;

  return next();
};

const resolveCompanyContext = (req, res, next) => {
  const resolve = () =>
    Promise.resolve(attachCompanyContext(req, res, next)).catch(next);

  if (req.userId) {
    return resolve();
  }

  return isAuthenticated(req, res, resolve);
};

export default resolveCompanyContext;
