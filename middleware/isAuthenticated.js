import {
  sendAuthError,
  verifyRequestToken,
} from "../utils/authToken.js";

const isAuthenticated = async (req, res, next) => {
  const { decoded, source, error } = verifyRequestToken({
    req,
    cookieName: "token",
    expectedScope: "dashboard",
  });

  if (error) {
    return sendAuthError(res, error);
  }

  const visibleUserId = String(req.get("x-dashboard-user-id") || "").trim();
  const tokenUserId = String(decoded._id || "").trim();

  if (visibleUserId && visibleUserId !== tokenUserId) {
    return res.status(401).json({
      success: false,
      code: "SESSION_REVOKED",
      message:
        "The visible dashboard user does not match the authenticated session. Please sign in again.",
    });
  }

  req.userId = decoded._id;
  req.authTokenSource = source;
  return next();
};

export default isAuthenticated;
