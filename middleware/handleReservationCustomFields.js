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
  normalizeCustomFieldOptions,
  validateCustomFieldAnswer,
} from "../utils/reservationCustomFieldService.js";
import { restaurantFieldsOnly } from "../utils/reservationFieldScope.js";

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
  session.reservationPhone = null;
  session.reservationSpecialRequest = null;
  session.reservationCustomFields = [];
  session.reservationCustomFieldIndex = 0;
  session.reservationCustomData = {};
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
      return sendReply({
        res,
        session,
        message,
        reply: "Okay, I cancelled the current reservation process. How else can I help you?",
      });
    }

    const handledSteps = new Set([
      "askPhone",
      "askCustomField",
      "askSpecialRequest",
    ]);

    if (!handledSteps.has(session.reservationStep)) {
      return next();
    }

    const [company, installation] = settings.companyId
      ? await Promise.all([
          Company.findById(settings.companyId)
            .select("reservationBusinessId isActive")
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

    if (session.reservationStep === "askPhone") {
      const phone = String(message).trim();

      if (phone.length < 8) {
        return sendReply({
          res,
          session,
          message,
          reply: "Please provide a valid phone number.",
        });
      }

      const fields = restaurantFieldsOnly(
        await getActiveBookingCustomFields(businessId),
      );
      session.reservationPhone = phone;
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

      session.reservationStep = "askSpecialRequest";
      return sendReply({
        res,
        session,
        message,
        reply:
          "Any special requests? Type **none** if there are no special requests.",
      });
    }

    if (session.reservationStep === "askCustomField") {
      const fields = session.reservationCustomFields || [];
      const index = Number(session.reservationCustomFieldIndex || 0);
      const field = fields[index];

      if (!field) {
        session.reservationStep = "askSpecialRequest";
        return sendReply({
          res,
          session,
          message,
          reply:
            "Any special requests? Type **none** if there are no special requests.",
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

      session.reservationCustomData = {
        ...(session.reservationCustomData || {}),
        [field.field_label]: validation.value,
      };
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

      session.reservationStep = "askSpecialRequest";
      return sendReply({
        res,
        session,
        message,
        reply:
          "Any special requests? Type **none** if there are no special requests.",
      });
    }

    const lowerMessage = String(message).trim().toLowerCase();
    session.reservationSpecialRequest =
      lowerMessage === "none" || lowerMessage === "skip"
        ? ""
        : String(message).trim();

    const latestFields = restaurantFieldsOnly(
      await getActiveBookingCustomFields(businessId),
    );
    const latestByLabel = new Map(
      latestFields.map((field) => [field.field_label, field]),
    );
    const customData = session.reservationCustomData || {};

    for (const field of latestFields) {
      const validation = validateCustomFieldAnswer(
        field,
        customData[field.field_label],
      );

      if (!validation.valid) {
        session.reservationCustomFields = latestFields;
        session.reservationCustomFieldIndex = latestFields.findIndex(
          (item) => item.field_label === field.field_label,
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

      customData[field.field_label] = validation.value;
    }

    Object.keys(customData).forEach((label) => {
      if (!latestByLabel.has(label)) delete customData[label];
    });

    const available = await checkReservationAvailability({
      businessId,
      reservationDate: session.reservationDate,
      reservationTime: session.reservationTime,
      partySize: session.reservationPartySize,
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
      phone: session.reservationPhone,
      reservationDate: session.reservationDate,
      reservationTime: session.reservationTime,
      partySize: session.reservationPartySize,
      specialRequest: session.reservationSpecialRequest,
      customData,
    });

    const customSummary = formatCustomData(customData);
    const reply = `✅ Reservation confirmed!\n\n**Reference:** ${reservation.reservation_reference}  \n**Name:** ${reservation.customer_name}  \n**Date:** ${reservation.reservation_date}  \n**Time:** ${reservation.reservation_time}  \n**Party size:** ${reservation.party_size}${customSummary ? `  \n${customSummary}` : ""}\n\nYour reservation has been added to the reservation dashboard.`;

    session.lastReservationReference = reservation.reservation_reference;
    session.lastReservationPhone = reservation.phone;
    clearReservationDraft(session);
    return sendReply({ res, session, message, reply });
  } catch (error) {
    console.error("Reservation custom-field integration error:", error);
    return next(error);
  }
}
