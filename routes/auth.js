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

const router = express.Router();

router.post("/signup/request-otp", requestSignupOTP);
router.post("/signup/verify-otp", verifySignupOTP);
router.post("/invitations/accept", acceptInvitation);
router.post("/password-reset/complete", completePasswordReset);
router.get("/google/callback", exchangeGoogleCode);
router.post("/login", login);
router.post("/logout", logout);
router.post("/platform-login", platformLogin);
router.post("/platform-logout", platformLogout);
router.get("/session", isVerifiedUser, getDashboardSession);
router.get(
  "/platform-session",
  isPlatformAuthenticated,
  isPlatformAdmin,
  getPlatformSession,
);

export default router;
