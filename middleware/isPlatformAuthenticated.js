import jwt from "jsonwebtoken";

const isPlatformAuthenticated = async (req, res, next) => {
  try {
    const token = req.cookies.platformToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Platform user not authenticated.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || decoded.authScope !== "platform") {
      return res.status(401).json({
        success: false,
        message: "Invalid platform session.",
      });
    }

    req.userId = decoded._id;
    req.platformRole = decoded.platformRole;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: