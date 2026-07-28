import express from "express";
import {
  saveGoogleApiKey,
  getGoogleAuthUrlController,
  createTimeSlot,
  updateTimeSlot,
  deleteTimeSlot,
  getAppointments,
  CancelAppointment,
  ConfirmAppointment,
  getTimeSlots,
  getUserCalenderConn,
  disconnectGoogleCalendar,
} from "../controllers/appointmentController.js";
import isVerifiedUser from "../middleware/isVerifiedUser.js";
import resolveCompanyContext from "../middleware/resolveCompanyContext.js";
import requireCompanyWriteAccess from "../middleware/requireCompanyWriteAccess.js";
import { signGoogleOAuthUrlState } from "../middleware/googleOAuthState.js";

const router = express.Router();

// ---------------- Google Authentication ----------------
router.get("/google-calender-conn", isVerifiedUser, getUserCalenderConn);
router.post(
  "/google-disconnect",
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  disconnectGoogleCalendar
);
router.get(
  "/google-auth-url",
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  signGoogleOAuthUrlState,
  getGoogleAuthUrlController
);

// ---------------- Time Slot Routes ----------------
router.post(
  "/time-slots",
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  createTimeSlot
);
router.patch(
  "/time-slots/:timeSlotId",
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  updateTimeSlot
);
router.delete(
  "/time-slots/:timeSlotId",
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  deleteTimeSlot
);
router.get("/time-slots", isVerifiedUser, getTimeSlots);

// ---------------- Appointment Routes ----------------
router.get("/get", isVerifiedUser, getAppointments);
router.put(
  "/:appointmentId/confirm",
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  ConfirmAppointment
);
router.put(
  "/:appointmentId/cancel",
  isVerifiedUser,
  resolveCompanyContext,
  requireCompanyWriteAccess,
  CancelAppointment
);

export default router;
