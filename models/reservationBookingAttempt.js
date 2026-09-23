import mongoose from "mongoose";

const ReservationBookingAttemptSchema = new mongoose.Schema(
  {
    bookingAttemptId: { type: String, required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    chatbotId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatbotSettings", required: true },
    sessionId: { type: String, required: true },
    reservationBusinessId: { type: Number, required: true },
    idempotencyKey: { type: String, required: true },
    journeyType: { type: String, required: true },
    status: { type: String, enum: ["draft", "confirmed", "processing", "completed", "failed", "cancelled", "unknown"], default: "draft" },
    requestFingerprint: { type: String, default: "" },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    errorCode: { type: String, default: null },
    notification: {
      email: {
        status: { type: String, enum: ["not_attempted", "sending", "sent", "failed"], default: "not_attempted" },
        attempts: { type: Number, default: 0 },
        claimToken: { type: String, default: null },
        claimedAt: { type: Date, default: null },
        lastAttemptAt: { type: Date, default: null },
        sentAt: { type: Date, default: null },
        providerMessageId: { type: String, default: null },
        failureCode: { type: String, default: null },
      },
    },
  },
  { timestamps: true },
);

// Prepared for R2B. autoIndex is disabled so importing this model cannot create a
// production index during R2A. Apply the reviewed index explicitly during rollout.
ReservationBookingAttemptSchema.set("autoIndex", false);
ReservationBookingAttemptSchema.index(
  { companyId: 1, idempotencyKey: 1 },
  { unique: true, name: "reservation_booking_attempt_company_key_unique" },
);

export default mongoose.model("ReservationBookingAttempt", ReservationBookingAttemptSchema);
