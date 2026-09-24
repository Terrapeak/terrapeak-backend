import ReservationBookingAttempt from "../models/reservationBookingAttempt.js";
import { fingerprintLegacyReservationRequest, fingerprintReservationBookingRequest, fingerprintRestaurantBookingRequest, fingerprintScheduledSessionBookingRequest } from "../utils/reservationRequestFingerprint.js";

export const buildReservationIdempotencyKey = ({ companyId, bookingAttemptId }) => {
  if (!companyId || !bookingAttemptId) {
    const error = new Error("A server-generated booking attempt identity is required.");
    error.code = "BOOKING_ATTEMPT_ID_REQUIRED";
    throw error;
  }
  return [companyId, bookingAttemptId].map((value) => String(value).trim()).join(":");
};

export const fingerprintReservationRequest = (value) =>
  value?.journeyType === "restaurant"
    ? fingerprintRestaurantBookingRequest(value).fingerprint
    : value?.journeyType === "scheduled_session"
    ? fingerprintScheduledSessionBookingRequest(value).fingerprint
    : value && value.reservationBusinessSlug && value.serviceSlug && value.providerSlug && value.startsAt
    ? fingerprintReservationBookingRequest(value).fingerprint
    : fingerprintLegacyReservationRequest(value);

export async function getOrCreateReservationBookingAttempt({
  context,
  journeyType,
  request,
  model = ReservationBookingAttempt,
}) {
  const bookingAttemptId = String(request?.bookingAttemptId || "").trim();
  const idempotencyKey = buildReservationIdempotencyKey({
    companyId: context.companyId,
    bookingAttemptId,
  });
  const requestFingerprint = request?.fingerprint || fingerprintReservationRequest(request?.fingerprintInput || request);
  const existing = await model.findOne({
    companyId: context.companyId,
    chatbotId: context.chatbotId,
    sessionId: context.sessionId,
    idempotencyKey,
  });
  if (existing) {
    if (existing.requestFingerprint && existing.requestFingerprint !== requestFingerprint) {
      const error = new Error("The reservation attempt conflicts with an existing request.");
      error.code = "BOOKING_ATTEMPT_CONFLICT";
      throw error;
    }
    return { attempt: existing, reused: true, idempotencyKey };
  }

  try {
    const attempt = await model.create({
      bookingAttemptId,
      companyId: context.companyId,
      chatbotId: context.chatbotId,
      sessionId: context.sessionId,
      reservationBusinessId: context.reservationBusinessId,
      idempotencyKey,
      journeyType,
      status: "draft",
      requestFingerprint,
    });
    return { attempt, reused: false, idempotencyKey };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const concurrent = await model.findOne({
      companyId: context.companyId,
      chatbotId: context.chatbotId,
      sessionId: context.sessionId,
      idempotencyKey,
    });
    if (!concurrent) throw error;
    if (concurrent.requestFingerprint && concurrent.requestFingerprint !== requestFingerprint) {
      const conflict = new Error("The reservation attempt conflicts with an existing request.");
      conflict.code = "BOOKING_ATTEMPT_CONFLICT";
      throw conflict;
    }
    return { attempt: concurrent, reused: true, idempotencyKey };
  }
}

export async function markReservationBookingAttemptConfirmed({
  context,
  bookingAttemptId,
  model = ReservationBookingAttempt,
}) {
  const idempotencyKey = buildReservationIdempotencyKey({
    companyId: context.companyId,
    bookingAttemptId,
  });
  const attempt = await model.findOneAndUpdate(
    {
      companyId: context.companyId,
      chatbotId: context.chatbotId,
      sessionId: context.sessionId,
      idempotencyKey,
      status: { $in: ["draft", "confirmed"] },
    },
    { $set: { status: "confirmed", errorCode: null } },
    { new: true },
  );
  if (!attempt) {
    const error = new Error("The reservation booking attempt is no longer writable.");
    error.code = "BOOKING_ATTEMPT_NOT_CONFIRMABLE";
    throw error;
  }
  return attempt;
}

export async function claimReservationBookingAttempt({
  context,
  bookingAttemptId,
  model = ReservationBookingAttempt,
}) {
  const idempotencyKey = buildReservationIdempotencyKey({
    companyId: context.companyId,
    bookingAttemptId,
  });
  return model.findOneAndUpdate(
    {
      companyId: context.companyId,
      chatbotId: context.chatbotId,
      sessionId: context.sessionId,
      idempotencyKey,
      status: "confirmed",
    },
    { $set: { status: "processing", errorCode: null } },
    { new: true },
  );
}

export async function completeReservationBookingAttempt({
  context,
  bookingAttemptId,
  result,
  model = ReservationBookingAttempt,
}) {
  const idempotencyKey = buildReservationIdempotencyKey({
    companyId: context.companyId,
    bookingAttemptId,
  });
  return model.findOneAndUpdate(
    { companyId: context.companyId, chatbotId: context.chatbotId, sessionId: context.sessionId, idempotencyKey, status: { $in: ["processing", "unknown", "failed"] } },
    { $set: { status: "completed", result, errorCode: null } },
    { new: true },
  );
}

export async function failReservationBookingAttempt({
  context,
  bookingAttemptId,
  errorCode,
  result = null,
  model = ReservationBookingAttempt,
}) {
  const idempotencyKey = buildReservationIdempotencyKey({
    companyId: context.companyId,
    bookingAttemptId,
  });
  return model.findOneAndUpdate(
    { companyId: context.companyId, chatbotId: context.chatbotId, sessionId: context.sessionId, idempotencyKey, status: { $in: ["processing", "unknown", "failed"] } },
    { $set: { status: "failed", result, errorCode } },
    { new: true },
  );
}
