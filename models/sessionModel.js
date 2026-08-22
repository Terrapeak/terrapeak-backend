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

    cancelReservationStep: String,
    cancelReservationId: String,
    cancelReservationOptions: {
      type: [String],
      default: [],
    },

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
  },
  {
    timestamps: true,
  },
);

function getScopedSessionId(sessionId, chatbotId) {
  if (!sessionId || !chatbotId) {
    return sessionId;
  }

  const chatbotIdString = chatbotId.toString();
  const prefix = `${chatbotIdString}:`;

  return sessionId.startsWith(prefix)
    ? sessionId
    : `${prefix}${sessionId}`;
}

// Browser storage can reuse the same raw session ID in preview and embedded
// chatbots. MongoDB currently has a global unique index on sessionId, so scope
// the stored value by chatbot without requiring controller changes.
sessionSchema.pre(/^find/, function scopeSessionLookup() {
  const query = this.getQuery();

  if (query.sessionId && query.chatbotId) {
    this.setQuery({
      ...query,
      sessionId: getScopedSessionId(query.sessionId, query.chatbotId),
    });
  }
});

sessionSchema.pre("validate", function scopeNewSession() {
  if (this.isNew) {
    this.sessionId = getScopedSessionId(this.sessionId, this.chatbotId);
  }
});

export default mongoose.model("Session", sessionSchema);
