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
import normalizeLoginFailure from "../middleware/normalizeLoginFailure.js";
import preventAuthCaching from "../middleware/preventAuthCaching.js";
import stripAuthTokens from "../middleware/stripAuthTokens.js";
import validateSignupPassword from "../middleware/validateSignupPassword.js";

const router = express.Router();

router.use(preventAuthCaching);

router.post(
  "/signup/request-otp",
  signupOtpRateLimit,
  validateSignupPassword,
  requestSignupOTP,
);
router.post(
  "/signup/verify-otp",
  accountTokenRateLimit,
  validateSignupPassword,
  verifySignupOTP,
);
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
router.post(
  "/login",
  loginRateLimit,
  normalizeLoginFailure,
  stripAuthTokens,
  login,
);
router.post("/logout", logout);
router.post(
  "/platform-login",
  platformLoginRateLimit,
  stripAuthTokens,
  platformLogin,
);
router.post("/platform-logout", platformLogout);
router.get("/session", isVerifiedUser, getDashboardSession);
router.get(
  "/platform-session",
  isPlatformAuthenticated,
  isPlatformAdmin,
  getPlatformSession,
);

export default router;
