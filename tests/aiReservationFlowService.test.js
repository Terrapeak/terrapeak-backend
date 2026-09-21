import assert from "node:assert/strict";
import test from "node:test";
import { confirmReservationFoundation, initializeReservationFlow, parseReservationConfirmation, prepareReservationConfirmation } from "../services/aiReservationFlowService.js";

const context = {
  companyId: "company-1", chatbotId: "chatbot-1", sessionId: "session-1", reservationBusinessId: 42,
  reservationBusinessSlug: "tenant-a",
  configuration: {
    bookingBehavior: { booking_behavior: "immediate", confirmation_message: "Done" },
    terminology: { bookingSingular: "Appointment" },
  },
};

const model = {
  attempts: [],
  async findOne(query) { return this.attempts.find((attempt) => attempt.idempotencyKey === query.idempotencyKey) || null; },
  async create(value) { const attempt = { ...value }; this.attempts.push(attempt); return attempt; },
};

test("confirmation parsing is deterministic", () => {
  assert.equal(parseReservationConfirmation("book it"), "confirm");
  assert.equal(parseReservationConfirmation("no"), "reject");
  assert.equal(parseReservationConfirmation("sounds good"), "unknown");
});

test("initializes a typed draft bound to the verified tenant", () => {
  const session = {};
  const flow = initializeReservationFlow({ context, session, journeyType: "appointment" });
  assert.equal(flow.status, "service_selection");
  assert.equal(flow.companyId, "company-1");
  assert.equal(flow.businessId, "42");
  assert.equal(flow.businessSlug, "tenant-a");
});

test("prepares a server-owned summary and awaits explicit confirmation", async () => {
  const session = {};
  const result = await prepareReservationConfirmation({
    context,
    session,
    flow: { version: 1, journeyType: "appointment", serviceId: "10", providerId: "20", quantity: 1 },
    service: { id: 10, name: "Consultation", durationMinutes: 45, price: 25, currency: "EUR" },
    provider: { id: 20, displayName: "Dr A", customDurationMinutes: 60, customPrice: 30 },
    slot: { startsAt: "2026-10-01T08:00:00Z", endsAt: "2026-10-01T09:00:00Z", localTime: "10:00", timezone: "Europe/Amsterdam" },
    customer: { name: "Aisha", email: "aisha@example.com", phone: "+31612345678" },
    form: [],
    model,
  });
  assert.equal(result.flowStatus, "awaiting_confirmation");
  assert.equal(session.reservationFlow.confirmation.summary.price, 30);
  assert.equal(session.reservationFlow.confirmation.summary.durationMinutes, 60);
  assert.equal(model.attempts.length, 1);
  assert.equal(session.reservationFlow.bookingAttemptId, model.attempts[0].bookingAttemptId);
});

test("feature gate blocks booking execution after confirmation", async () => {
  const session = {
    reservationFlow: {
      status: "awaiting_confirmation",
      confirmation: { summary: { serviceName: "Consultation" } },
    },
  };
  const calls = { booking: 0, session: 0, restaurant: 0, cohort: 0, legacy: 0 };
  const createBooking = () => { calls.booking += 1; };
  const createSessionBooking = () => { calls.session += 1; };
  const createRestaurantReservation = () => { calls.restaurant += 1; };
  const createClassEnquiry = () => { calls.cohort += 1; };
  const createReservation = () => { calls.legacy += 1; };
  const result = await confirmReservationFoundation({
    context,
    session,
    message: "confirm",
    env: {},
    createBooking,
    createSessionBooking,
    createRestaurantReservation,
    createClassEnquiry,
    createReservation,
  });
  assert.equal(result.errorCode, "TRANSACTIONAL_BOOKING_DISABLED");
  assert.equal(result.fallbackRequired, true);
  assert.equal(result.bookingCreated, undefined);
  assert.deepEqual(calls, { booking: 0, session: 0, restaurant: 0, cohort: 0, legacy: 0 });
});

test("negative or ambiguous confirmation never becomes write-authorized", async () => {
  const session = { reservationFlow: { status: "awaiting_confirmation", confirmation: { summary: {} } } };
  assert.equal((await confirmReservationFoundation({ context, session, message: "no", env: { AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED: "true" } })).flowStatus, "cancelled");
  session.reservationFlow.status = "awaiting_confirmation";
  assert.equal((await confirmReservationFoundation({ context, session, message: "maybe", env: { AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED: "true" } })).errorCode, "CONFIRMATION_REQUIRED");
});
