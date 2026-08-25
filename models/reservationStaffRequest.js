import mongoose from "mongoose";

const reservationStaffRequestSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    chatbotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatbotSettings",
      default: null,
      index: true,
    },
    sessionId: { type: String, default: "", index: true },
    reservationBusinessId: { type: Number, default: null, index: true },
    reservationTemplate: { type: String, default: "general", index: true },
    type: {
      type: String,
      enum: ["callback", "reschedule", "cancellation_review"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "reviewing", "completed", "dismissed"],
      default: "pending",
      index: true,
    },
    customerName: { type: String, default: "" },
    customerContact: { type: String, default: "" },
    reservationReference: { type: String, default: "", index: true },
    reservationId: { type: String, default: "" },
    currentBooking: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    requestedChange: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    summary: { type: String, default: "" },
    policyWarning: { type: String, default: "" },
    bookingUrl: { type: String, default: "" },
    source: { type: String, default: "ai-assistant" },
  },
  { timestamps: true },
);

reservationStaffRequestSchema.index({
  companyId: 1,
  status: 1,
  createdAt: -1,
});

export default mongoose.model(
  "ReservationStaffRequest",
  reservationStaffRequestSchema,
);
