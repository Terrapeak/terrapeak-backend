import User from "../models/user.js";
import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";

const PLATFORM_ADMIN_ROLES = [
  "platform-owner",
  "platform-admin",
  "support-admin",
  "billing-admin",
  "developer-admin",
  "sales-admin",
  "viewer",
];

const isPlatformAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);

    if (!user || !PLATFORM_ADMIN_ROLES.includes(user.platformRole)) {
      return res.status(403).json({
        success: false,
        message: "Platform admin access required.",
      });
    }

    const platformCompanies = await Company.find({
      isPlatformWorkspace: true,
      isActive: true,
    }).select("_id");

    if (platformCompanies.length !== 1) {
      console.error(
        `Platform configuration error: expected exactly one Platform Workspace, found ${platformCompanies.length}.`
      );

      return res.status(500).json({
        success: false,
        message: "Platform configuration error. Please contact Terrapeak.",
      });
    }

    const platformMembership = await CompanyMembership.findOne({
      companyId: platformCompanies[0]._id,
      userId: user._id,
      status: "active",
    }).select("_id");

    if (!platformMembership) {
      return res.status(403).json({
        success: false,
        message: "Terrapeak platform access required.",
      });
    }

    req.platformUser = user;
    req.platformRole = user.platformRole;
    req.platformCompanyId = platformCompanies[0]._id;

    return next();
  } catch (error) {
    console.error("Platform admin check failed:", error);

    return res.status(500).json({
      success: false,
      message: "Platform admin check failed.",
    });
  }
};

export default isPlatformAdmin;
