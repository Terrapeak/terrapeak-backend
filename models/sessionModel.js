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

/*
 * The chatbot controller keeps a session document in memory while it processes
 * a message and saves it at the end of the request. Two near-simultaneous
 * requests can therefore both observe that no session exists and both attempt
 * to insert the same unique sessionId. MongoDB accepts the first insert and
 * rejects the second with E11000.
 *
 * Claim the session row with an atomic upsert before Mongoose performs the
 * normal save. The current document is then converted into an existing
 * document, so the remainder of the save becomes an update rather than a
 * second insert. This preserves the current controller flow while removing the
 * find-then-insert race.
 */
sessionSchema.pre("save", async function claimNewSessionAtomically() {
  if (!this.isNew) {
    return;
  }

  const SessionModel = this.constructor;
  const insertData = this.toObject({ depopulate: true });

  delete insertData.__v;
  delete insertData.createdAt;
  delete insertData.updatedAt;

  const claimedSession = await SessionModel.findOneAndUpdate(
    {
      sessionId: this.sessionId,
      chatbotId: this.chatbotId,
    },
    {
      $setOnInsert: insertData,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  this._id = claimedSession._id;
  this.$isNew = false;
});

export default mongoose.model("Session", sessionSchema);
