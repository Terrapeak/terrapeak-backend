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
import isAuthenticated from "../middleware/isAuthenticated.js";
import isVerifiedUser from "../middleware/isVerifiedUser.js";

const router = express.Router();

// ---------------- Google Authentication ----------------
router.get("/google-calender-conn", isAuthenticated, getUserCalenderConn);
router.post("/google-disconnect", isAuthenticated, disconnectGoogleCalendar);
router.get("/google-auth-url", isVerifiedUser, getGoogleAuthUrlController); // Get OAuth URL

//router.post("/google-api-key", isAuthenticated, saveGoogleApiKey); // Optional API key save

// ---------------- Time Slot Routes ----------------
router.post("/time-slots", isAuthenticated, createTimeSlot); // Create slot
router.patch("/time-slots/:timeSlotId", isAuthenticated, updateTimeSlot);
router.delete("/time-slots/:timeSlotId", isAuthenticated, deleteTimeSlot);
router.get("/time-slots", isAuthenticated, getTimeSlots); // Guests can check availability

// ---------------- Appointment Routes ----------------
//router.post("/", bookAppointment); // Guest booking allowed
router.get("/get", isAuthenticated, getAppointments); // Owner only
router.put("/:appointmentId/confirm", isAuthenticated, ConfirmAppointment); // Owner confirms
router.put("/:appointmentId/cancel", isAuthenticated, CancelAppointment); // Owner cancels (instead of delete)

export default router;
