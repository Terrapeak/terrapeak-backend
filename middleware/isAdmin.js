import User from "../models/user.js";
import {
  sendAuthError,
  verifyRequestToken,
} from "../utils/authToken.js";

const isAdmin = async (req, res, next) => {
  try {
    if (!req.userId) {
      const { decoded, source, error } = verifyRequestToken({
        req,
        cookieName: "token",
        expectedScope: "dashboard",
      });

      if (error) {
        return sendAuthError(res, error);
      }

      req.userId = decoded._id;
      req.authTokenSource = source;
    }

    const user = await User.findById(req.userId).select(
      "_id isAdmin isApproved",
    );

    if (!user || !user.isApproved || user.isAdmin !== true) {
      return res.status(403).json({
        success: false,
        code: "ADMIN_ACCESS_REQUIRED",
        message: "Dashboard administrator access is required.",
      });
    }

    return next();
  } catch (error) {
    console.error("Dashboard admin check failed:", error);
    return res.status(500).json({
      success: false,
      code: "ADMIN_CHECK_FAILED",
      message: "Dashboard administrator check failed.",
    });
  }
};

export default isAdmin;
