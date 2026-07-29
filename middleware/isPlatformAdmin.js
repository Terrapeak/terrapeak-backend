import User from "../models/user.js";
import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";

const PLATFORM_ADMIN_ROLES = [
  "platform-owner",
  "platform-admin",
];

const isPlatformAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(403).json({
        success: false,
        code: "PLATFORM_ACCESS_DENIED",
        message: "Platform admin access required.",
      });
    }

    if (
      user.passwordChangedAt &&
      req.authTokenIssuedAt &&
      req.authTokenIssuedAt * 1000 < user.passwordChangedAt.getTime() - 1000
    ) {
      return res.status(401).json({
        success: false,
        code: "SESSION_REVOKED",
        message: "Your session is no longer valid. Please sign in again.",
      });
    }

    if (user.accountStatus !== "active") {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_INACTIVE",
        message: "This account is not active.",
      });
    }

    if (!PLATFORM_ADMIN_ROLES.includes(user.platformRole)) {
      return res.status(403).json({
        success: false,
        code: "PLATFORM_ACCESS_DENIED",
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
        code: "PLATFORM_CONFIGURATION_INVALID",
        message: "Platform configuration error. Please contact TerraPeak.",
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
        code: "PLATFORM_MEMBERSHIP_REQUIRED",
        message: "TerraPeak platform access required.",
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
      code: "PLATFORM_AUTHORIZATION_FAILED",
      message: "Platform admin check failed.",
    });
  }
};

export default isPlatformAdmin;
