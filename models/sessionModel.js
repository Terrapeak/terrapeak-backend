import mongoose from "mongoose";

const reservationFlowSchema = new mongoose.Schema(
  {
    version: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ["idle", "guest_count", "service_selection", "provider_selection", "date_selection", "slot_selection", "customer_form", "review", "awaiting_confirmation", "ready_to_commit", "completed", "cancelled", "failed", "unknown"],
      default: "idle",
    },
    journeyType: { type: String, enum: ["appointment", "restaurant", "scheduled_session", "cohort_enquiry", null], default: null },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    installationId: { type: mongoose.Schema.Types.ObjectId, ref: "CompanyAppInstallation", default: null },
    businessId: { type: String, default: null },
    businessSlug: { type: String, default: null },
    templateKey: { type: String, default: null },
    serviceId: { type: String, default: null },
    serviceSlug: { type: String, default: null },
    serviceName: { type: String, default: null },
    providerId: { type: String, default: null },
    providerSlug: { type: String, default: null },
    providerName: { type: String, default: null },
    scheduledSessionId: { type: String, default: null },
    scheduledSessionEndsAt: { type: Date, default: null },
    scheduledSessionRemainingCapacity: { type: Number, default: null },
    localDate: { type: String, default: null },
    localTime: { type: String, default: null },
    startsAt: { type: Date, default: null },
    timezone: { type: String, default: null },
    quantity: { type: Number, default: 1 },
    customer: { type: mongoose.Schema.Types.Mixed, default: {} },
    customData: { type: mongoose.Schema.Types.Mixed, default: {} },
    customerFormSnapshot: { type: mongoose.Schema.Types.Mixed, default: [] },
    displaySnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    confirmation: { type: mongoose.Schema.Types.Mixed, default: {} },
    selectionOptions: { type: mongoose.Schema.Types.Mixed, default: [] },
    contextSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    formFieldIndex: { type: Number, default: 0 },
    currentCustomField: { type: String, default: null },
    customFieldIndex: { type: Number, default: 0 },
    requestedBooking: { type: Boolean, default: false },
    bookingAttemptId: { type: String, default: null },
    idempotencyKey: { type: String, default: null },
  },
  { _id: false },
);

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

    bookingType: {
      type: String,
      enum: ["appointment", "reservation", "clarify", null],
      default: null,
    },

    reservationStep: String,
    reservationBusinessSlug: String,
    reservationDate: String,
    reservationTime: String,
    reservationPartySize: Number,
    reservationName: String,
    reservationPhone: String,
    reservationSpecialRequest: String,
    reservationOccasion: String,
    reservationAllergies: String,
    reservationSeatingPreference: String,
    reservationCustomFields: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    reservationCustomFieldIndex: {
      type: Number,
      default: 0,
    },
    reservationCustomData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    reservationLookupStep: String,
    lastReservationReference: String,
    lastReservationPhone: String,

    reservationCallbackStep: String,
    reservationCallbackName: String,
    reservationCallbackContact: String,
    reservationCallbackPreferredTime: String,
    reservationCallbackQuestion: String,
    reservationCallbackServiceOrTeacher: String,
    reservationCallbackSummary: String,
    reservationCallbackBookingUrl: String,
    reservationCallbackRequestedAt: Date,

    reservationRescheduleStep: String,
    rescheduleReservationId: String,
    rescheduleReservationOptions: {
      type: [String],
      default: [],
    },
    rescheduleReservationData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    rescheduleReservationRequest: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    cancelReservationStep: String,
    cancelReservationId: String,
    cancelReservationOptions: {
      type: [String],
      default: [],
    },
    cancelReservationData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    cancelReservationOptionDetails: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    cancelReservationRequiresStaffApproval: {
      type: Boolean,
      default: false,
    },
    cancelReservationPolicyWarning: String,

    appointmentStep: String,
    appointmentDate: String,
    appointmentName: String,
    appointmentEmail: String,
    appointmentPhone: String,

    cancelTypeStep: String,
    forceAppointmentCancel: Boolean,
    cancelAppointmentLookupStep: String,
    rescheduleStep: String,
    rescheduleAppointmentId: String,
    rescheduleAppointmentOptions: {
      type: [String],
      default: [],
    },
    isRescheduling: {
      type: Boolean,
      default: false,
    },

    cancelStep: String,
    cancelAppointmentId: String,
    cancelAppointmentOptions: {
      type: [String],
      default: [],
    },

    // appointmentAddress: String,
    tempSlots: Array,
    selectedSlot: String,

    // R2A typed foundation. Legacy fields above remain for compatibility.
    reservationFlow: {
      type: reservationFlowSchema,
      default: () => ({ status: "idle", version: 1 }),
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("Session", sessionSchema);
