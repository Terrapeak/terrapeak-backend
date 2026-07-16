import express from "express";
import {
  requestSignupOTP,
  verifySignupOTP,
  login,
  logout,
} from "../controllers/authController.js";
import {
  acceptInvitation,
  completePasswordReset,
} from "../controllers/accountLifecycleController.js";
import { exchangeGoogleCode } from "../controllers/appointmentController.js";

const router = express.Router();

router.post("/signup/request-otp", requestSignupOTP);
router.post("/signup/verify-otp", verifySignupOTP);
router.post("/invitations/accept", acceptInvitation);
router.post("/password-reset/complete", completePasswordReset);
router.get("/google/callback", exchangeGoogleCode);
router.post("/login", login);
router.post("/logout", logout);

export default router;
