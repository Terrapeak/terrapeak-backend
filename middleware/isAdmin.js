import jwt from "jsonwebtoken";

const isAdmin = async (req, res, next) => {
  const authorizationHeader = req.get("authorization");
  const bearerToken = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice(7).trim()
    : null;

  const token = bearerToken || req.cookies?.token;

  if (!token) {
    return res.status(401).json({
      message: "User not authenticated",
      success: false,
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.authScope && decoded.authScope !== "dashboard") {
      return res.status(401).json({
        message: "Invalid authentication scope",
        success: false,
      });
    }

    if (!decoded.isAdmin) {
      return res.status(403).json({
        message: "User is not an admin",
        success: false,
      });
    }

    req.userId = decoded._id;
    req.authTokenSource = bearerToken ? "bearer" : "cookie";
    next();
  } catch (error) {
    const message =
      error?.name === "TokenExpiredError" ? "JWT expired" : "Invalid token";

    return res.status(401).json({
      message,
      success: false,
    });
  }
};

export default isAdmin;
