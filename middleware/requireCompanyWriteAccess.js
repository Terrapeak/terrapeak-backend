const WRITABLE_COMPANY_ROLES = new Set(["owner", "admin", "manager", "staff"]);
const DELEGATED_OPERATIONAL_PATHS = new Set([
  "/reservations/callback-requests/:requestId",
  "/channels/facebook/connect",
  "/time-slots",
  "/time-slots/:timeSlotId",
  "/:appointmentId/confirm",
  "/:appointmentId/cancel",
]);

const requireCompanyWriteAccess = (req, res, next) => {
  const role = req.companyMembership?.role;
  const delegatedAccess =
    req.companyAccess?.accessSource === "distributor_delegated_access";
  const delegatedOperationalPath = DELEGATED_OPERATIONAL_PATHS.has(
    req.route?.path,
  );

  if (
    (!role || !WRITABLE_COMPANY_ROLES.has(role)) &&
    !(delegatedAccess && delegatedOperationalPath)
  ) {
    return res.status(403).json({
      success: false,
      code: "COMPANY_WRITE_ACCESS_DENIED",
      message: "Your Company role provides view-only access.",
    });
  }

  return next();
};

export default requireCompanyWriteAccess;
