import User from "../models/user.js";

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

    req.platformUser = user;
    req.platformRole = user.platformRole;

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Platform admin check failed.",
    });
  }
};

export default isPlatformAdmin;