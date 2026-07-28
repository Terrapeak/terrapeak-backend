import express from "express";
import {
  requestSignupOTP,
  verifySignupOTP,
  login,
  logout,
  platformLogin,
  platformLogout,
} from "../controllers/authController.js";
import {
  acceptInvitation,
  changeTemporaryPassword,
  completePasswordReset,
} from "../controllers/accountLifecycleController.js";
import { exchangeGoogleCode } from "../controllers/appointmentController.js";
import {
  getDashboardSession,
  getPlatformSession,
} from "../controllers/sessionController.js";
import isVerifiedUser from "../middleware/isVerifiedUser.js";
import isPlatformAuthenticated from "../middleware/isPlatformAuthenticated.js";
import isPlatformAdmin from "../middleware/isPlatformAdmin.js";
import {
  accountTokenRateLimit,
  loginRateLimit,
  platformLoginRateLimit,
  signupOtpRateLimit,
} from "../middleware/authRateLimits.js";

const router = express.Router();

router.post("/signup/request-otp", signupOtpRateLimit, requestSignupOTP);
router.post("/signup/verify-otp", accountTokenRateLimit, verifySignupOTP);
router.post("/invitations/accept", accountTokenRateLimit, acceptInvitation);
router.post(
  "/password-reset/complete",
  accountTokenRateLimit,
  completePasswordReset,
);
router.post(
  "/temporary-password/change",
  accountTokenRateLimit,
  isVerifiedUser,
  changeTemporaryPassword,
);
router.get("/google/callback", exchangeGoogleCode);
router.post("/login", loginRateLimit, login);
router.post("/logout", logout);
router.post("/platform-login", platformLoginRateLimit, platformLogin);
router.post("/platform-logout", platformLogout);
router.get("/session", isVerifiedUser, getDashboardSession);
router.get(
  "/platform-session",
  isPlatformAuthenticated,
  isPlatformAdmin,
  getPlatformSession,
);

export default router;
