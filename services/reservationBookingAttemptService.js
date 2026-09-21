import { createHash } from "node:crypto";
import ReservationBookingAttempt from "../models/reservationBookingAttempt.js";

export const buildReservationIdempotencyKey = ({ companyId, bookingAttemptId }) => {
  if (!companyId || !bookingAttemptId) {
    const error = new Error("A server-generated booking attempt identity is required.");
    error.code = "BOOKING_ATTEMPT_ID_REQUIRED";
    throw error;
  }
  return [companyId, bookingAttemptId].map((value) => String(value).trim()).join(":");
};

const stableSerialize = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
};

export const fingerprintReservationRequest = (value) =>
  createHash("sha256").update(stableSerialize(value || {})).digest("hex");

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
  const requestFingerprint = fingerprintReservationRequest(request?.fingerprintInput || request);
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
