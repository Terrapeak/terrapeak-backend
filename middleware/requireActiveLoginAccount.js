import User from "../models/user.js";

const requireActiveLoginAccount = async (req, res, next) => {
  try {
    const normalizedEmail = req.body?.email?.trim?.().toLowerCase?.();

    if (!normalizedEmail) {
      return next();
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      "accountStatus isApproved",
    );

    if (!user) {
      return next();
    }

    if (user.accountStatus !== "active") {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_INACTIVE",
        message: "This account is not active.",
      });
    }

    return next();
  } catch (error) {
    console.error("Login account status check failed:", error);
    return res.status(500).json({
      success: false,
      code: "LOGIN_ACCOUNT_CHECK_FAILED",
      message: "Unable to verify account status.",
    });
  }
};

export default requireActiveLoginAccount;
