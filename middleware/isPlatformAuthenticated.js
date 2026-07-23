import jwt from "jsonwebtoken";

const isPlatformAuthenticated = async (req, res, next) => {
  try {
    const authorizationHeader = req.get("authorization");
    const bearerToken = authorizationHeader?.startsWith("Bearer ")
      ? authorizationHeader.slice(7).trim()
      : null;

    const token = bearerToken || req.cookies?.platformToken;

    if (!token) {
      return res.status(401).json({
        code: "TOKEN_MISSING",
        success: false,
        message: "Platform user not authenticated.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || decoded.authScope !== "platform") {
      return res.status(401).json({
        code: "AUTH_SCOPE_INVALID",
        success: false,
        message: "Invalid platform session.",
      });
    }

    req.userId = decoded._id;
    req.platformRole = decoded.platformRole;
    req.authTokenSource = bearerToken ? "bearer" : "cookie";

    return next();
  } catch (error) {
    const expired = error?.name === "TokenExpiredError";

    return res.status(401).json({
      code: expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
      success: false,
      message: expired
        ? "JWT expired"
        : "Invalid or expired platform session.",
    });
  }
};

export default isPlatformAuthenticated;
