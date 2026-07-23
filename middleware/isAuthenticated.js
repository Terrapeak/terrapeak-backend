import jwt from "jsonwebtoken";

const isAuthenticated = async (req, res, next) => {
  const authorizationHeader = req.get("authorization");
  const bearerToken = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice(7).trim()
    : null;

  const token = bearerToken || req.cookies?.token;

  if (!token) {
    return res.status(401).json({
      code: "TOKEN_MISSING",
      message: "User not authenticated",
      success: false,
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.authScope && decoded.authScope !== "dashboard") {
      return res.status(401).json({
        code: "AUTH_SCOPE_INVALID",
        message: "Invalid authentication scope",
        success: false,
      });
    }

    req.userId = decoded._id;
    req.authTokenSource = bearerToken ? "bearer" : "cookie";
    next();
  } catch (error) {
    const expired = error?.name === "TokenExpiredError";

    return res.status(401).json({
      code: expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
      message: expired ? "JWT expired" : "Invalid token",
      success: false,
    });
  }
};

export default isAuthenticated;
