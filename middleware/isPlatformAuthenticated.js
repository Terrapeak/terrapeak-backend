import {
  sendAuthError,
  verifyRequestToken,
} from "../utils/authToken.js";

const isPlatformAuthenticated = async (req, res, next) => {
  const { decoded, source, error } = verifyRequestToken({
    req,
    cookieName: "platformToken",
    expectedScope: "platform",
  });

  if (error) {
    return sendAuthError(res, error);
  }

  req.userId = decoded._id;
  req.platformRole = decoded.platformRole;
  req.authTokenSource = source;
  return next();
};

export default isPlatformAuthenticated;
