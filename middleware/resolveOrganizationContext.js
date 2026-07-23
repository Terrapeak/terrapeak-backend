import mongoose from "mongoose";

import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import User from "../models/user.js";
import isAuthenticated from "./isAuthenticated.js";

const sendError = (res, status, code, message) =>
  res.status(status).json({
    success: false,
    code,
    message,
  });

const attachOrganizationContext = async (req, res, next) => {
  const routeOrganizationId = String(
    req.params?.organizationId || ""
  ).trim();
  const headerOrganizationId = String(
    req.get("x-organization-id") || ""
  ).trim();

  if (
    routeOrganizationId &&
    headerOrganizationId &&
    routeOrganizationId !== headerOrganizationId
  ) {
    return sendError(
      res,
      400,
      "INVALID_ORGANIZATION_CONTEXT",
      "The Organization context does not match the route."
    );
  }

  const organizationId =
    routeOrganizationId || headerOrganizationId;

  if (!organizationId) {
    return sendError(
      res,
      409,
      "ORGANIZATION_CONTEXT_REQUIRED",
      "Select an Organization explicitly."
    );
  }

  if (!mongoose.Types.ObjectId.isValid(organizationId)) {
    return sendError(
      res,
      400,
      "INVALID_ORGANIZATION_CONTEXT",
      "The selected Organization is invalid."
    );
  }

  const user = await User.findById(req.userId).select(
    "_id platformRole isApproved"
  );

  if (
    !user ||
    !user.isApproved ||
    (user.platformRole && user.platformRole !== "none")
  ) {
    return sendError(
      res,
      403,
      "ORGANIZATION_ACCESS_DENIED",
      "Organization access is not available for this user."
    );
  }

  const organization = await Organization.findById(organizationId);

  if (!organization) {
    return sendError(
      res,
      404,
      "ORGANIZATION_NOT_FOUND",
      "Organization not found."
    );
  }

  if (organization.status !== "active") {
    return sendError(
      res,
      403,
      "ORGANIZATION_INACTIVE",
      "This Organization is not active."
    );
  }

  const membership = await OrganizationMembership.findOne({
    organizationId: organization._id,
    userId: user._id,
    status: "active",
  });

  if (!membership) {
    return sendError(
      res,
      403,
      "ORGANIZATION_ACCESS_DENIED",
      "Active Organization membership is required."
    );
  }

  req.organization = organization;
  req.organizationMembership = membership;
  req.organizationUser = user;

  return next();
};

const resolveOrganizationContext = (req, res, next) => {
  const resolve = () =>
    Promise.resolve(attachOrganizationContext(req, res, next)).catch(next);

  if (req.userId) return resolve();
  return isAuthenticated(req, res, resolve);
};

export const requireOrganizationMembership = (req, res, next) => {
  if (
    !req.organization ||
    !req.organizationMembership ||
    req.organizationMembership.status !== "active"
  ) {
    return sendError(
      res,
      403,
      "ORGANIZATION_ACCESS_DENIED",
      "Active Organization membership is required."
    );
  }

  return next();
};

export const requireOrganizationRole = (...allowedRoles) =>
  (req, res, next) => {
    if (
      !req.organizationMembership ||
      req.organizationMembership.status !== "active" ||
      !allowedRoles.includes(req.organizationMembership.role)
    ) {
      return sendError(
        res,
        403,
        "ORGANIZATION_ROLE_REQUIRED",
        "A permitted Organization role is required."
      );
    }

    return next();
  };

export default resolveOrganizationContext;
