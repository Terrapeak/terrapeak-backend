import Session from "../models/sessionModel.js";
import {
  ChatReservationContextError,
  resolveChatReservationContext,
} from "../services/chatReservationContextService.js";

const RESERVATION_KEYWORDS = [
  "reservation",
  "reserve",
  "book",
  "booking",
  "booking form",
  "make a booking",
  "make booking",
  "appointment",
  "sign up",
  "signup",
  "register",
  "enrol",
  "enroll",
  "join class",
  "book a table",
  "table booking",
  "reschedule table",
  "cancel table",
  "restaurant",
  "dinner",
  "lunch",
  "haircut",
  "hairdresser",
  "salon",
  "barber",
  "physio",
  "physical therapist",
  "therapy",
  "clinic",
  "doctor",
  "dentist",
  "gp",
  "general practitioner",
  "service appointment",
  "visit",
  "in person",
  "in-person",
];

const reservationIntent = (message = "") => {
  const text = String(message).toLowerCase();
  return RESERVATION_KEYWORDS.some((keyword) => text.includes(keyword));
};

const reservationSessionActive = (session) =>
  Boolean(
    session &&
      (session.bookingType === "reservation" ||
        session.reservationStep ||
        session.cancelReservationStep ||
        session.reservationRescheduleStep ||
        session.rescheduleReservationId ||
        session.cancelReservationId)
  );

export default async function requireReservationTenantForChat(req, res, next) {
  try {
    const apiKey = req.headers["x-api-key"];
    const { sessionId, chatbotId, message } = req.body || {};

    if (!apiKey || !chatbotId) return next();

    let session = null;
    if (sessionId) {
      session = await Session.findOne({
        sessionId,
        chatbotId,
      }).select(
        "bookingType reservationStep cancelReservationStep reservationRescheduleStep rescheduleReservationId cancelReservationId",
      );
    }

    const reservationRequested =
      reservationIntent(message) || reservationSessionActive(session);

    if (!reservationRequested) return next();

    const context = await resolveChatReservationContext({ apiKey, chatbotId, sessionId });
    req.chatReservationContext = context;
    return next();
  } catch (error) {
    if (error instanceof ChatReservationContextError) {
      return res.json({
        success: true,
        reply: "Reservations are not available for this business right now. Please use the existing booking form or contact the business directly.",
        code: error.code,
      });
    }
    return next(error);
  }
}
