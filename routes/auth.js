import express from "express";
import {
  requestSignupOTP,
  verifySignupOTP,
  login,
  logout,
} from "../controllers/authController.js";
import { exchangeGoogleCode } from "../controllers/appointmentController.js";
const router = express.Router();

// Signup flow
router.post("/signup/request-otp", requestSignupOTP);   // Step 1: send OTP
router.post("/signup/verify-otp", verifySignupOTP);     // Step 2: verify & create user
router.get("/google/callback", exchangeGoogleCode);
// Login & Logout
router.post("/login", login);
router.post("/logout", logout);

export default router;
