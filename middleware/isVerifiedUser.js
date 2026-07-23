import jwt from "jsonwebtoken";
import User from "../models/user.js";

const isVerifiedUser = async (req, res, next) => {
  try {
    const authorizationHeader = req.get("authorization");
    const bearerToken = authorizationHeader?.startsWith("Bearer ")
      ? authorizationHeader.slice(7).trim()
      : null;

    const token = bearerToken || req.cookies?.token;

    if (!token) {
      return res
        .status(401)
        .json({ message: "User not authenticated", success: false });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.authScope && decoded.authScope !== "dashboard") {
      return res
        .status(401)
        .json({ message: "Invalid authentication scope", success: false });
    }

    const user = await User.findById(decoded._id);
    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found", success: false });
    }

    if (!user.isApproved) {
      return res
        .status(403)
        .json({ message: "User not approved by admin", success: false });
    }

    req.userId = user._id;
    req.user = user;
    req.authTokenSource = bearerToken ? "bearer" : "cookie";
    next();
  } catch (error) {
    const status =
      error?.name === "TokenExpiredError" || error?.name === "JsonWebTokenError"
        ? 401
        : 500;

    const message =
      error?.name === "TokenExpiredError"
        ? "JWT expired"
        : error?.name === "JsonWebTokenError"
        ? "Invalid token"
        : "Internal server error";

    console.error(error);
    return res.status(status).json({ message, success: false });
  }
};

export default isVerifiedUser;
