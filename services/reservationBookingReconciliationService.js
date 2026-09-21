import {
  completeReservationBookingAttempt,
  failReservationBookingAttempt,
} from "./reservationBookingAttemptService.js";

export const DEFAULT_RESERVATION_PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;

const isUnknownAttempt = (attempt) =>
  attempt?.status === "unknown" ||
  (attempt?.status === "failed" && attempt?.errorCode === "BOOKING_RESULT_UNKNOWN");

const attemptAgeMs = (attempt, now) => {
  const timestamp = attempt?.updatedAt || attempt?.createdAt;
  return timestamp ? Math.max(0, now - new Date(timestamp).getTime()) : Infinity;
};

export async function reconcileReservationBookingAttempt({
  attempt,
  context,
  writeAdapter,
  model,
  now = Date.now(),
  staleAfterMs = DEFAULT_RESERVATION_PROCESSING_TIMEOUT_MS,
  forceLookup = false,
}) {
  if (!attempt || !["processing", "unknown", "failed"].includes(attempt.status) || (attempt.status === "failed" && !isUnknownAttempt(attempt))) {
    return { status: "not_reconcilable", lookupPerformed: false };
  }
  if (String(attempt.companyId) !== String(context.companyId) || String(attempt.reservationBusinessId) !== String(context.reservationBusinessId)) {
    const error = new Error("The reservation attempt does not belong to this tenant.");
    error.code = "RESERVATION_TENANT_MISMATCH";
    throw error;
  }
  if (!forceLookup && attempt.status === "processing" && attemptAgeMs(attempt, now) < staleAfterMs) {
    return { status: "in_progress", errorCode: "BOOKING_IN_PROGRESS", lookupPerformed: false };
  }

  const recovered = await writeAdapter.findByIdempotencyKey({
    reservationBusinessSlug: context.reservationBusinessSlug,
    idempotencyKey: attempt.idempotencyKey,
  });
  if (!recovered) return { status: "unresolved", errorCode: "BOOKING_RESULT_UNKNOWN", lookupPerformed: true };
  if (recovered.requestFingerprint !== attempt.requestFingerprint) {
    await failReservationBookingAttempt({
      context,
      bookingAttemptId: attempt.bookingAttemptId,
      errorCode: "IDEMPOTENCY_REQUEST_CONFLICT",
      model,
    });
    return { status: "conflict", errorCode: "IDEMPOTENCY_REQUEST_CONFLICT", lookupPerformed: true };
  }
  const completed = await completeReservationBookingAttempt({
    context,
    bookingAttemptId: attempt.bookingAttemptId,
    result: recovered,
    model,
  });
  if (!completed) return { status: "unresolved", errorCode: "BOOKING_RESULT_UNKNOWN", lookupPerformed: true };
  return { status: "completed", result: recovered, lookupPerformed: true };
}
