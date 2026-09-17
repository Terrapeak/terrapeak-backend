import mongoose from "mongoose";

import isAuthenticated from "./isAuthenticated.js";
import resolveCompanyAccess from "../services/companyAccessService.js";

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

  const access = await resolveCompanyAccess({
    userId: req.userId,
    companyId: requestedCompanyId || null,
    user: req.user || null,
  });

  if (requestedCompanyId && !access?.allowed) {
    return res.status(403).json({
      success: false,
      code: "COMPANY_ACCESS_DENIED",
      message: "You do not have active access to the selected company.",
    });
  }

  if (!access) {
    return res.status(404).json({
      success: false,
      code: "COMPANY_CONTEXT_NOT_FOUND",
      message: "No active customer company membership was found.",
    });
  }

  if (access.reason === "multiple_companies") {
    return res.status(409).json({
      success: false,
      code: "COMPANY_CONTEXT_REQUIRED",
      message: "Select a company using the x-company-id header.",
    });
  }

  req.companyAccess = access;
  req.companyMembership = access.companyMembership;
  req.company = access.company;

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
