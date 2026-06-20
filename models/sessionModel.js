import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
    },
    chatbotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatbotSettings",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    preActivationData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isPreview: { type: Boolean, default: false },
    timeZone: String,
    chatLogs: [
      {
        role: {
          type: String,
          enum: ["user", "model"],
          required: true,
        },
        text: {
          type: String,
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    appointmentStep: String,
appointmentDate: String,
appointmentName: String,
appointmentEmail: String,
appointmentPhone: String,

cancelStep: String,
cancelAppointmentId: String,

// appointmentAddress: String,
tempSlots: Array,
selectedSlot: String,
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Session", sessionSchema);
