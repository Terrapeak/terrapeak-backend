import ChatbotSettings from "../models/chatbotSettings.js";
import Session from "../models/sessionModel.js";

const RESERVATION_KEYWORDS = [
  "reservation",
  "reserve",
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

    const settings = await ChatbotSettings.findOne({ apiKey }).select(
      "_id reservationBusinessSlug reservationEnabled",
    );

    if (!settings || String(settings._id) !== String(chatbotId)) {
      return next();
    }

    let session = null;
    if (sessionId) {
      session = await Session.findOne({
        sessionId,
        chatbotId: settings._id,
      }).select(
        "bookingType reservationStep cancelReservationStep reservationRescheduleStep rescheduleReservationId cancelReservationId",
      );
    }

    const reservationRequested =
      reservationIntent(message) || reservationSessionActive(session);

    if (!reservationRequested) return next();

    const businessSlug = String(settings.reservationBusinessSlug || "").trim();

    if (settings.reservationEnabled === false || !businessSlug) {
      return res.json({
        success: true,
        reply:
          "Reservations are not configured for this business. Please contact the business directly or try again later.",
        code: "RESERVATIONS_NOT_CONFIGURED",
      });
    }

    return next();
  } catch (error) {
    console.error("Reservation tenant guard error:", error);
    return next(error);
  }
}
