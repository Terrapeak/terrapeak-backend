import User from "../models/user.js";
import {
  sendAuthError,
  verifyRequestToken,
} from "../utils/authToken.js";

const isVerifiedUser = async (req, res, next) => {
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
      req.authTokenIssuedAt = decoded.iat;
      req.authTokenSource = source;
    }

    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "User not found.",
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

    if (!user.isApproved) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_NOT_APPROVED",
        message: "User is not approved.",
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    console.error("Verified user check failed:", error);
    return res.status(500).json({
      success: false,
      code: "AUTH_CHECK_FAILED",
      message: "Authentication check failed.",
    });
  }
};

export default isVerifiedUser;
