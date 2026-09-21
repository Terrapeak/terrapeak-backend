import assert from "node:assert/strict";
import test from "node:test";
import { getOrCreateReservationBookingAttempt, fingerprintReservationRequest } from "../services/reservationBookingAttemptService.js";

const context = { companyId: "company-1", chatbotId: "chatbot-1", sessionId: "session-1", reservationBusinessId: 42 };

test("booking attempts require a server-generated attempt identity", async () => {
  await assert.rejects(
    getOrCreateReservationBookingAttempt({ context, journeyType: "appointment", request: { version: 1 }, model: { findOne: async () => null } }),
    (error) => error.code === "BOOKING_ATTEMPT_ID_REQUIRED",
  );
});

test("server-generated attempt identity is reused for duplicate confirmation", async () => {
  const attempts = [];
  const model = {
    findOne: async (query) => attempts.find((attempt) => attempt.idempotencyKey === query.idempotencyKey) || null,
    create: async (value) => { attempts.push(value); return value; },
  };
  const request = { version: 1, bookingAttemptId: "attempt-a", fingerprintInput: { serviceId: 10, startsAt: "2026-10-01T10:00:00Z" } };
  const first = await getOrCreateReservationBookingAttempt({ context, journeyType: "appointment", request, model });
  const second = await getOrCreateReservationBookingAttempt({ context, journeyType: "appointment", request, model });
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(first.attempt.bookingAttemptId, second.attempt.bookingAttemptId);
  assert.equal(attempts.length, 1);
});

test("a different request cannot reuse the same tenant/session attempt", async () => {
  const attempt = { idempotencyKey: "company-1:attempt-a", requestFingerprint: "different" };
  const model = { findOne: async () => attempt };
  await assert.rejects(
    getOrCreateReservationBookingAttempt({ context, journeyType: "appointment", request: { version: 1, bookingAttemptId: "attempt-a", fingerprintInput: { serviceId: 10 } }, model }),
    (error) => error.code === "BOOKING_ATTEMPT_CONFLICT",
  );
});

test("a later legitimate booking in the same session gets a new attempt", async () => {
  const attempts = [];
  const model = {
    findOne: async (query) => attempts.find((attempt) => attempt.idempotencyKey === query.idempotencyKey) || null,
    create: async (value) => { attempts.push(value); return value; },
  };
  const first = await getOrCreateReservationBookingAttempt({
    context, journeyType: "appointment",
    request: { bookingAttemptId: "attempt-a", fingerprintInput: { serviceId: "service-a", startsAt: "2026-10-01T10:00:00Z" } }, model,
  });
  const second = await getOrCreateReservationBookingAttempt({
    context, journeyType: "appointment",
    request: { bookingAttemptId: "attempt-b", fingerprintInput: { serviceId: "service-b", startsAt: "2026-10-01T16:00:00Z" } }, model,
  });
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
  assert.equal(attempts.length, 2);
});

test("concurrent duplicate confirmation resolves to one canonical attempt", async () => {
  const attempts = [];
  let createCalls = 0;
  const model = {
    findOne: async (query) => attempts.find((attempt) => attempt.idempotencyKey === query.idempotencyKey) || null,
    create: async (value) => {
      createCalls += 1;
      if (createCalls > 1) {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
      }
      attempts.push(value);
      await new Promise((resolve) => setImmediate(resolve));
      return value;
    },
  };
  const request = { bookingAttemptId: "attempt-concurrent", fingerprintInput: { serviceId: "service-a", startsAt: "2026-10-01T10:00:00Z" } };
  const [first, second] = await Promise.all([
    getOrCreateReservationBookingAttempt({ context, journeyType: "appointment", request, model }),
    getOrCreateReservationBookingAttempt({ context, journeyType: "appointment", request, model }),
  ]);
  assert.equal(createCalls, 2);
  assert.equal(attempts.length, 1);
  assert.equal(first.attempt.bookingAttemptId, second.attempt.bookingAttemptId);
  assert.equal([first.reused, second.reused].sort().join(","), "false,true");
});

test("the same local attempt identity is isolated by company", async () => {
  const attempts = [];
  const model = {
    findOne: async (query) => attempts.find((attempt) => attempt.idempotencyKey === query.idempotencyKey) || null,
    create: async (value) => { attempts.push(value); return value; },
  };
  const request = { bookingAttemptId: "same-local-id", fingerprintInput: { serviceId: "service-a" } };
  const tenantA = await getOrCreateReservationBookingAttempt({ context, journeyType: "appointment", request, model });
  const tenantB = await getOrCreateReservationBookingAttempt({ context: { ...context, companyId: "company-2" }, journeyType: "appointment", request, model });
  assert.notEqual(tenantA.idempotencyKey, tenantB.idempotencyKey);
  assert.equal(attempts.length, 2);
});

test("fingerprints are stable across object key order", () => {
  assert.equal(
    fingerprintReservationRequest({ serviceId: 10, customer: { email: "a@example.com", name: "A" } }),
    fingerprintReservationRequest({ customer: { name: "A", email: "a@example.com" }, serviceId: 10 }),
  );
  assert.notEqual(
    fingerprintReservationRequest({ startsAt: new Date("2026-10-01T10:00:00Z") }),
    fingerprintReservationRequest({ startsAt: new Date("2026-10-01T16:00:00Z") }),
  );
});

test("the model prepares a tenant-scoped unique index without enabling auto-index creation", async () => {
  const { default: ReservationBookingAttempt } = await import("../models/reservationBookingAttempt.js");
  assert.equal(ReservationBookingAttempt.schema.get("autoIndex"), false);
  assert.deepEqual(ReservationBookingAttempt.schema.indexes(), [[
    { companyId: 1, idempotencyKey: 1 },
    { unique: true, name: "reservation_booking_attempt_company_key_unique", background: true },
  ]]);
});
