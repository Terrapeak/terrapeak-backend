import mongoose from "mongoose";

// Appointment Schema
const appointmentSchema = new mongoose.Schema({
  timeSlotId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TimeSlot",
    required: true,
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  //address: { type: String, required: true, trim: true },
  meetingLink: { type: String }, // <-- store Google Meet link
  googleEventId: { type: String },
  clientTimeZone: { type: String, required: true }, 
  status: {
    type: String,
    enum: ["pending", "confirmed", "cancelled"],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now },
});

const Appointment = mongoose.model("Appointment", appointmentSchema);
export default Appointment;
