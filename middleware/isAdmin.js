
import jwt from "jsonwebtoken";

const isAdmin = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ message: "User not authenticated", success: false });
  }

  const decoded = await jwt.verify(token, process.env.JWT_SECRET);
  if (!decoded) {
    return res.status(401).json({ message: "Invalid token", success: false });
  }

  if (!decoded.isAdmin) {
    return res.status(403).json({ message: "User is not an admin", success: false });
  }

  req.userId = decoded._id;
  next();
};

export default isAdmin;
