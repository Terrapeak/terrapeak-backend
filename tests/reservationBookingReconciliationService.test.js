import assert from "node:assert/strict";
import test from "node:test";
import { reconcileReservationBookingAttempt } from "../services/reservationBookingReconciliationService.js";

const context = { companyId: "company-1", reservationBusinessId: 42, reservationBusinessSlug: "tenant-a" };

const makeModel = (row) => ({
  async findOneAndUpdate(query, update) {
    const matchesStatus = query.status?.$in ? query.status.$in.includes(row.status) : row.status === query.status;
    if (!matchesStatus) return null;
    Object.assign(row, update.$set);
    return row;
  },
});

test("stale processing with a matching booking completes without a write", async () => {
  const attempt = { companyId: "company-1", reservationBusinessId: 42, bookingAttemptId: "a", idempotencyKey: "k", requestFingerprint: "fp", status: "processing", updatedAt: new Date(0) };
  const result = await reconcileReservationBookingAttempt({
    attempt, context, model: makeModel(attempt), now: 1000000, staleAfterMs: 1,
    writeAdapter: { async findByIdempotencyKey() { return { bookingId: "b", reference: "BK-1", requestFingerprint: "fp" }; } },
  });
  assert.equal(result.status, "completed");
  assert.equal(attempt.status, "completed");
});

test("fresh processing returns in progress without lookup or write", async () => {
  const attempt = { companyId: "company-1", reservationBusinessId: 42, bookingAttemptId: "a", idempotencyKey: "k", requestFingerprint: "fp", status: "processing", updatedAt: new Date(999999) };
  let lookups = 0;
  const result = await reconcileReservationBookingAttempt({
    attempt, context, model: makeModel(attempt), now: 1000000,
    writeAdapter: { async findByIdempotencyKey() { lookups += 1; } },
  });
  assert.equal(result.errorCode, "BOOKING_IN_PROGRESS");
  assert.equal(lookups, 0);
});

test("unknown without a booking remains unresolved and never creates one", async () => {
  const attempt = { companyId: "company-1", reservationBusinessId: 42, bookingAttemptId: "a", idempotencyKey: "k", requestFingerprint: "fp", status: "unknown", updatedAt: new Date(0) };
  const result = await reconcileReservationBookingAttempt({
    attempt, context, model: makeModel(attempt),
    writeAdapter: { async findByIdempotencyKey() { return null; } },
  });
  assert.equal(result.status, "unresolved");
  assert.equal(attempt.status, "unknown");
});

test("a mismatched recovered fingerprint fails closed", async () => {
  const attempt = { companyId: "company-1", reservationBusinessId: 42, bookingAttemptId: "a", idempotencyKey: "k", requestFingerprint: "fp", status: "unknown", updatedAt: new Date(0) };
  const result = await reconcileReservationBookingAttempt({
    attempt, context, model: makeModel(attempt),
    writeAdapter: { async findByIdempotencyKey() { return { bookingId: "b", reference: "BK-1", requestFingerprint: "other" }; } },
  });
  assert.equal(result.errorCode, "IDEMPOTENCY_REQUEST_CONFLICT");
  assert.equal(attempt.status, "failed");
});
