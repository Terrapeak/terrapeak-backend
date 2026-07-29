import CompanyAppInstallation from "../models/companyAppInstallation.js";

export default function requireCompanyApp(appSlug) {
  return async function requireCompanyAppMiddleware(req, res, next) {
    try {
      const companyId = req.company?._id;

      if (!companyId) {
        return res.status(400).json({
          success: false,
          code: "COMPANY_CONTEXT_REQUIRED",
          message: "A valid company context is required.",
        });
      }

      const installation = await CompanyAppInstallation.findOne({
        companyId,
        appSlug,
        enabled: true,
        status: { $ne: "disabled" },
      }).lean();

      if (!installation) {
        return res.status(403).json({
          success: false,
          code: "APP_ACCESS_REQUIRED",
          message: "This application is not enabled for the selected company.",
        });
      }

      req.companyAppInstallation = installation;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
