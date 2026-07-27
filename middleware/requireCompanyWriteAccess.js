const WRITABLE_COMPANY_ROLES = new Set(["owner", "admin", "manager", "staff"]);

const requireCompanyWriteAccess = (req, res, next) => {
  const role = req.companyMembership?.role;

  if (!role || !WRITABLE_COMPANY_ROLES.has(role)) {
    return res.status(403).json({
      success: false,
      code: "COMPANY_WRITE_ACCESS_DENIED",
      message: "Your Company role provides view-only access.",
    });
  }

  return next();
};

export default requireCompanyWriteAccess;
