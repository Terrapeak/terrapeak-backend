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

  req.userId = decoded._id;
  req.authTokenSource = source;
  return next();
};

export default isAuthenticated;
