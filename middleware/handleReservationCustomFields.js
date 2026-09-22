import ChatbotSettings from "../models/chatbotSettings.js";
import Session from "../models/sessionModel.js";
import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import {
  checkReservationAvailability,
  createReservation,
} from "../utils/reservationService.js";
import {
  buildCustomFieldPrompt,
  getActiveBookingCustomFields,
  getCustomFieldIdentityKey,
  normalizeCustomFieldOptions,
  validateCustomFieldAnswer,
} from "../utils/reservationCustomFieldService.js";

const appendChatExchange = (session, message, reply) => {
  session.chatLogs.push(
    { role: "user", text: message, timestamp: new Date() },
    { role: "model", text: reply, timestamp: new Date() },
  );
};

const clearReservationDraft = (session) => {
  session.bookingType = null;
  session.reservationStep = null;
  session.reservationDate = null;
  session.reservationTime = null;
  session.reservationPartySize = null;
  session.reservationName = null;
  session.reservationEmail = null;
  session.reservationPhone = null;
  session.reservationSpecialRequest = null;
  session.reservationCustomFields = [];
  session.reservationCustomFieldIndex = 0;
  session.reservationCustomData = {};
};

const clearReservationCallbackDraft = (session) => {
  session.set({
    reservationCallbackStep: null,
    reservationCallbackName: null,
    reservationCallbackContact: null,
    reservationCallbackPreferredTime: null,
    reservationCallbackQuestion: null,
    reservationCallbackServiceOrTeacher: null,
    reservationCallbackSummary: null,
    reservationCallbackBookingUrl: null,
    reservationCallbackRequestedAt: null,
  });
};

const getCustomFieldInput = (field) => {
  if (!field) return null;

  if (field.field_type === "dropdown") {
    const options = normalizeCustomFieldOptions(field.field_options);
    if (!options.length) return null;

    return {
      type: options.length <= 6 ? "quick-replies" : "select",
      fieldId: String(field.id || field._id || field.field_label),
      label: field.field_label,
      required: Boolean(field.is_required),
      options: options.map((option) => ({ label: option, value: option })),
    };
  }

  if (field.field_type === "checkbox") {
    return {
      type: "quick-replies",
      fieldId: String(field.id || field._id || field.field_label),
      label: field.field_label,
      required: Boolean(field.is_required),
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    };
  }

  return null;
};

const sendReply = async ({ res, session, message, reply, input = null, code = null }) => {
  appendChatExchange(session, message, reply);
  await session.save();

  return res.json({
    success: true,
    reply,
    input,
    ...(code ? { code } : {}),
    appointmentStep: session.appointmentStep,
    reservationStep: session.reservationStep,
    bookingType: session.bookingType,
    cancelStep: session.cancelStep,
  });
};

const formatCustomData = (customData = {}) =>
  Object.entries(customData)
    .filter(([, value]) => String(value || "").trim())
    .map(([label, value]) => `**${label}:** ${value}`)
    .join("  \n");

const normalizeDateAnswer = (value) => {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : text;
};

const normalizeTimeAnswer = (value) => {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  const meridiem = match[3];
  if (minute < 0 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const fieldIdentityKey = getCustomFieldIdentityKey;

const applyFieldAnswerToSession = (session, field, value) => {
  const identity = fieldIdentityKey(field);
  if (identity === "name") {
    session.reservationName = value;
    return;
  }
  if (identity === "phone") {
    session.reservationPhone = value;
    return;
  }
  if (identity === "email") {
    session.reservationEmail = value;
    return;
  }

  session.reservationCustomData = {
    ...(session.reservationCustomData || {}),
    [field.field_label]: value,
  };
};

const completeReservationFromSession = async ({
  businessId,
  session,
  res,
  message,
}) => {
  const fields = session.reservationCustomFields || [];
  const customData = session.reservationCustomData || {};

  if (!session.reservationDate) {
    session.reservationStep = "askDate";
    return sendReply({
      res,
      session,
      message,
      reply: "What date would you like? Please use YYYY-MM-DD format.",
    });
  }

  if (!session.reservationTime) {
    session.reservationStep = "askTime";
    return sendReply({
      res,
      session,
      message,
      reply: "What time would you like? Please use HH:MM, for example 14:30.",
    });
  }

  for (const field of fields) {
    const identity = fieldIdentityKey(field);
    const storedValue = identity === "name"
      ? session.reservationName
      : identity === "phone"
        ? session.reservationPhone
        : identity === "email"
          ? session.reservationEmail
          : customData[field.field_label];
    const validation = validateCustomFieldAnswer(field, storedValue);

    if (!validation.valid) {
      session.reservationCustomFieldIndex = fields.findIndex(
        (item) => String(item.id) === String(field.id),
      );
      session.reservationStep = "askCustomField";
      return sendReply({
        res,
        session,
        message,
        reply: `${validation.error}\n\n${buildCustomFieldPrompt(field)}`,
        input: getCustomFieldInput(field),
      });
    }
  }

  const available = await checkReservationAvailability({
    businessId,
    reservationDate: session.reservationDate,
    reservationTime: session.reservationTime,
    partySize: session.reservationPartySize || 1,
  });

  if (!available) {
    session.reservationStep = "askTime";
    return sendReply({
      res,
      session,
      message,
      reply:
        "Sorry, that reservation slot is no longer available. Please choose another time in HH:MM format.",
    });
  }

  const reservation = await createReservation({
    businessId,
    customerName: session.reservationName,
    email: session.reservationEmail,
    phone: session.reservationPhone,
    reservationDate: session.reservationDate,
    reservationTime: session.reservationTime,
    partySize: session.reservationPartySize || 1,
    specialRequest: session.reservationSpecialRequest,
    customData,
  });

  const customSummary = formatCustomData(customData);
  const reply = `✅ Reservation confirmed!\n\n**Reference:** ${reservation.reservation_reference}  \n**Name:** ${reservation.customer_name}  \n**Date:** ${reservation.reservation_date}  \n**Time:** ${reservation.reservation_time}  \n**Party size:** ${reservation.party_size}${customSummary ? `  \n${customSummary}` : ""}\n\nYour reservation has been added to the reservation dashboard.`;

  session.lastReservationReference = reservation.reservation_reference;
  session.lastReservationPhone = reservation.phone;
  clearReservationDraft(session);
  return sendReply({ res, session, message, reply });
};

export default async function handleReservationCustomFields(req, res, next) {
  try {
    const { sessionId, chatbotId, message } = req.body || {};
    const apiKey = req.headers["x-api-key"];

    if (!sessionId || !chatbotId || !message || !apiKey) {
      return next();
    }

    const settings = await ChatbotSettings.findOne({ apiKey }).select(
      "_id companyId reservationEnabled",
    );

    if (!settings || String(settings._id) !== String(chatbotId)) {
      return next();
    }

    const session = await Session.findOne({
      sessionId,
      chatbotId: settings._id,
    });

    if (!session || session.bookingType !== "reservation") {
      return next();
    }

    const normalizedMessage = String(message).trim().toLowerCase();
    if (["cancel", "stop", "exit", "quit"].includes(normalizedMessage)) {
      clearReservationDraft(session);
      clearReservationCallbackDraft(session);
      return sendReply({
        res,
        session,
        message,
        reply: "Okay, I cancelled the current reservation process. How else can I help you?",
      });
    }

    const handledSteps = new Set([
      "askDate",
      "askTime",
      "askPartySize",
      "askPhone",
      "askCustomField",
    ]);

    if (!handledSteps.has(session.reservationStep)) {
      return next();
    }

    const [company, installation] = settings.companyId
      ? await Promise.all([
          Company.findById(settings.companyId)
            .select("reservationBusinessId reservationTemplate isActive")
            .lean(),
          CompanyAppInstallation.findOne({
            companyId: settings.companyId,
            appSlug: "reservations",
            enabled: true,
            status: "active",
          })
            .select("_id")
            .lean(),
        ])
      : [null, null];

    const businessId = Number(company?.reservationBusinessId);
    if (
      settings.reservationEnabled === false ||
      company?.isActive === false ||
      !installation ||
      !Number.isFinite(businessId) ||
      businessId < 1
    ) {
      clearReservationDraft(session);
      return sendReply({
        res,
        session,
        message,
        reply:
          "Reservations are not configured for this business. Please contact the business directly or try again later.",
        code: "RESERVATIONS_NOT_CONFIGURED",
      });
    }

    const isRestaurant = (company?.reservationTemplate || "general") === "restaurant";

    if (session.reservationStep === "askDate") {
      const date = normalizeDateAnswer(message);
      if (!date) {
        return sendReply({
          res,
          session,
          message,
          reply: "Please enter the booking date in YYYY-MM-DD format.",
        });
      }

      session.reservationDate = date;
      session.reservationStep = "askTime";
      return sendReply({
        res,
        session,
        message,
        reply: "What time would you like? Please use HH:MM, for example 14:30.",
      });
    }

    if (session.reservationStep === "askTime") {
      const time = normalizeTimeAnswer(message);
      if (!time) {
        return sendReply({
          res,
          session,
          message,
          reply: "Please enter a valid time, for example 14:30 or 2:30 PM.",
        });
      }

      session.reservationTime = time;
      if (isRestaurant) {
        session.reservationStep = "askPartySize";
        return sendReply({
          res,
          session,
          message,
          reply: "How many guests should the reservation be for?",
        });
      }

      session.reservationPartySize = 1;
      const existingFields = session.reservationCustomFields || [];
      const existingIndex = Number(session.reservationCustomFieldIndex || 0);
      if (existingFields.length && existingIndex >= existingFields.length) {
        return completeReservationFromSession({
          businessId,
          session,
          res,
          message,
        });
      }

      const fields = existingFields.length
        ? existingFields
        : await getActiveBookingCustomFields(businessId);
      session.reservationCustomFields = fields;
      session.reservationCustomFieldIndex = existingFields.length ? existingIndex : 0;
      session.reservationCustomData = session.reservationCustomData || {};

      if (fields.length > 0) {
        session.reservationStep = "askCustomField";
        const field = fields[session.reservationCustomFieldIndex] || fields[0];
        return sendReply({
          res,
          session,
          message,
          reply: buildCustomFieldPrompt(field),
          input: getCustomFieldInput(field),
        });
      }

      return completeReservationFromSession({
        businessId,
        session,
        res,
        message,
      });
    }

    if (session.reservationStep === "askPartySize") {
      const partySize = Number.parseInt(String(message).trim(), 10);
      if (!Number.isFinite(partySize) || partySize < 1) {
        return sendReply({
          res,
          session,
          message,
          reply: "Please enter a valid number of guests.",
        });
      }

      session.reservationPartySize = partySize;
      const fields = await getActiveBookingCustomFields(businessId);
      session.reservationCustomFields = fields;
      session.reservationCustomFieldIndex = 0;
      session.reservationCustomData = {};

      if (fields.length > 0) {
        session.reservationStep = "askCustomField";
        return sendReply({
          res,
          session,
          message,
          reply: buildCustomFieldPrompt(fields[0]),
          input: getCustomFieldInput(fields[0]),
        });
      }

      return completeReservationFromSession({
        businessId,
        session,
        res,
        message,
      });
    }

    if (session.reservationStep === "askPhone") {
      session.reservationStep = "askCustomField";
      session.reservationCustomFields = await getActiveBookingCustomFields(businessId);
      const phoneIndex = session.reservationCustomFields.findIndex(
        (field) => fieldIdentityKey(field) === "phone",
      );
      session.reservationCustomFieldIndex = phoneIndex >= 0 ? phoneIndex : 0;
    }

    if (session.reservationStep === "askCustomField") {
      let fields = session.reservationCustomFields || [];
      if (!fields.length) {
        fields = await getActiveBookingCustomFields(businessId);
        session.reservationCustomFields = fields;
      }

      const index = Number(session.reservationCustomFieldIndex || 0);
      const field = fields[index];

      if (!field) {
        return completeReservationFromSession({
          businessId,
          session,
          res,
          message,
        });
      }

      const validation = validateCustomFieldAnswer(field, message);

      if (!validation.valid) {
        return sendReply({
          res,
          session,
          message,
          reply: `${validation.error}\n\n${buildCustomFieldPrompt(field)}`,
          input: getCustomFieldInput(field),
        });
      }

      applyFieldAnswerToSession(session, field, validation.value);

      session.reservationCustomFieldIndex = index + 1;

      const nextField = fields[index + 1];
      if (nextField) {
        return sendReply({
          res,
          session,
          message,
          reply: buildCustomFieldPrompt(nextField),
          input: getCustomFieldInput(nextField),
        });
      }

      return completeReservationFromSession({
        businessId,
        session,
        res,
        message,
      });
    }

    return next();
  } catch (error) {
    console.error("Reservation custom-field integration error:", error);
    return next(error);
  }
}
