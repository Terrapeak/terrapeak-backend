import mongoose from "mongoose"
// Time Slot Schema
const timeSlotSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    start: { type: Date, required: true }, // stored in UTC
    end: { type: Date, required: true }, // stored in UTC
    timeZone: { type: String, required: true }, //  user timezone
    isBooked: { type: Boolean, default: false },
  },
  { timestamps: true }
);
const TimeSlot = mongoose.model('TimeSlot', timeSlotSchema)

export default TimeSlot;


