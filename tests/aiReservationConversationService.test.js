import assert from "node:assert/strict";
import test from "node:test";
import { handleAiReservationConversation, isGenericBookingIntent, isNaturalServiceBookingIntent } from "../services/aiReservationConversationService.js";

const context = {
  companyId: "company-1", chatbotId: "chatbot-1", sessionId: "session-1",
  reservationBusinessId: 42, reservationBusinessSlug: "tenant-a",
  configuration: { templateKey: "general", capabilities: { services: true }, bookingBehavior: { booking_behavior: "immediate" } },
};

const readAdapter = {
  async listBookableServices() { return [{ id: 1, slug: "acceptance-test-service", name: "Acceptance Test Service" }]; },
  async listBookableProviders() { return [{ id: 2, slug: "dr-a", displayName: "Dr A" }]; },
  async listAppointmentAvailability() { return [{ startsAt: "2099-01-15T09:00:00.000Z", endsAt: "2099-01-15T10:00:00.000Z", localTime: "09:00", timezone: "UTC" }]; },
  async getCustomerForm() { return []; },
};

const multiServiceReadAdapter = {
  ...readAdapter,
  async listBookableServices() {
    return [
      { id: 1, slug: "dental-cleaning", name: "Dental Cleaning" },
      { id: 2, slug: "initial-consultation", name: "Initial Consultation" },
      { id: 3, slug: "follow-up-consultation", name: "Follow-up Consultation" },
    ];
  },
};

const acceptanceForm = [
  { id: "acceptance-textarea", label: "Acceptance Textarea", type: "textarea", active: true },
  { id: "acceptance-dropdown", label: "Acceptance Dropdown", type: "dropdown", options: ["Option A", "Option B"], active: true },
  { id: "acceptance-checkbox", label: "Acceptance Checkbox", type: "checkbox", active: true },
  { id: "acceptance-number", label: "Acceptance Number", type: "number", active: true },
  { id: "acceptance-date", label: "Acceptance Date", type: "date", active: true },
  { id: "special-requests", label: "Special requests", type: "text", active: true },
  { id: "acceptance-reason", label: "acceptance reason 2", type: "text", active: true },
];

const makeSlot = (localTime, startsAt) => ({
  startsAt,
  endsAt: "2026-09-23T02:00:00.000Z",
  localTime,
  timezone: "Asia/Kuala_Lumpur",
});

function makeAttemptModel() {
  const rows = [];
  return {
    rows,
    async findOne(query) {
      return rows.find((row) => Object.entries(query).every(([key, value]) => {
        if (key === "status" && value?.$in) return value.$in.includes(row[key]);
        return String(row[key]) === String(value);
      })) || null;
    },
    async create(row) {
      rows.push({ ...row });
      return rows.at(-1);
    },
    async findOneAndUpdate(query, update) {
      const row = await this.findOne(query);
      if (!row) return null;
      Object.assign(row, update.$set);
      return row;
    },
  };
}

test("appointment conversation collects an explicit summary before confirmation", async () => {
  const session = {};
  let result = await handleAiReservationConversation({ context, session, message: "I want to book an appointment", readAdapter });
  assert.equal(result.handled, true);
  assert.equal(session.reservationFlow.status, "service_selection");
  result = await handleAiReservationConversation({ context, session, message: "1", readAdapter });
  assert.equal(session.reservationFlow.status, "provider_selection");
  result = await handleAiReservationConversation({ context, session, message: "1", readAdapter });
  assert.equal(session.reservationFlow.status, "date_selection");
  await handleAiReservationConversation({ context, session, message: "2099-01-15", readAdapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter });
  await handleAiReservationConversation({ context, session, message: "Aisha", readAdapter });
  await handleAiReservationConversation({ context, session, message: "aisha@example.com", readAdapter });
  const confirmation = await handleAiReservationConversation({ context, session, message: "+31612345678", readAdapter, model: {
    async findOne() { return null; },
    async create(value) { return value; },
  } });
  assert.equal(confirmation.handled, true);
  assert.equal(session.reservationFlow.status, "awaiting_confirmation");
  assert.equal(confirmation.reservation.confirmationRequired, true);
});

test("time labels match exactly before numeric ordinal fallback", async () => {
  const slots = [
    makeSlot("09:00:00", "2026-09-23T01:00:00.000Z"),
    ...Array.from({ length: 7 }, (_, index) => makeSlot(`0${10 + index}:00:00`, `2026-09-23T03:00:00.000Z`)),
    makeSlot("13:00:00", "2026-09-23T05:00:00.000Z"),
  ];

  const exactSession = { reservationFlow: { status: "slot_selection", selectionOptions: slots } };
  await handleAiReservationConversation({ context, session: exactSession, message: "09:00:00", readAdapter });
  assert.equal(exactSession.reservationFlow.startsAt, "2026-09-23T01:00:00.000Z");
  assert.equal(exactSession.reservationFlow.status, "customer_form");

  const ordinalSession = { reservationFlow: { status: "slot_selection", selectionOptions: slots } };
  await handleAiReservationConversation({ context, session: ordinalSession, message: "9", readAdapter });
  assert.equal(ordinalSession.reservationFlow.startsAt, "2026-09-23T05:00:00.000Z");

  for (const message of ["09:00", "9:00", "9abc", "9 PM"]) {
    const invalidSession = { reservationFlow: { status: "slot_selection", selectionOptions: slots } };
    await handleAiReservationConversation({ context, session: invalidSession, message, readAdapter });
    assert.equal(invalidSession.reservationFlow.status, "slot_selection", message);
    assert.equal(invalidSession.reservationFlow.startsAt, undefined, message);
  }
});

test("service and provider labels remain exact case-insensitive matches", async () => {
  const serviceSession = {
    reservationFlow: {
      status: "service_selection",
      selectionOptions: [{ id: 1, slug: "acceptance-test-service", name: "Acceptance Test Service" }],
    },
  };
  await handleAiReservationConversation({ context, session: serviceSession, message: "ACCEPTANCE-TEST-SERVICE", readAdapter });
  assert.equal(serviceSession.reservationFlow.serviceId, 1);
  assert.equal(serviceSession.reservationFlow.status, "provider_selection");

  const providerSession = {
    reservationFlow: {
      status: "provider_selection",
      selectionOptions: [{ id: 2, slug: "acceptance-test-team-member", displayName: "Acceptance Test Team Member" }],
    },
  };
  await handleAiReservationConversation({ context, session: providerSession, message: "ACCEPTANCE-TEST-TEAM-MEMBER", readAdapter });
  assert.equal(providerSession.reservationFlow.providerId, 2);
  assert.equal(providerSession.reservationFlow.status, "date_selection");
});

test("unsupported restaurant journeys stay outside the appointment write flow", async () => {
  const result = await handleAiReservationConversation({
    context: { ...context, configuration: { ...context.configuration, templateKey: "restaurant", capabilities: { guestCount: true } } },
    session: {},
    message: "I want to book a table",
    readAdapter,
  });
  assert.equal(result.handled, false);
});

test("request booking behavior never invokes an appointment write", async () => {
  const session = {};
  const requestContext = { ...context, configuration: { ...context.configuration, bookingBehavior: { booking_behavior: "request" } } };
  const model = { async findOne() { return null; }, async create(value) { return value; } };
  for (const message of ["book an appointment", "1", "1", "2099-01-15", "1", "Aisha", "aisha@example.com"]) {
    await handleAiReservationConversation({ context: requestContext, session, message, readAdapter, model });
  }
  let writes = 0;
  const result = await handleAiReservationConversation({ context: requestContext, session, message: "+31612345678", readAdapter, model, writeAdapter: { async createAppointment() { writes += 1; } } });
  assert.equal(writes, 0);
  assert.match(result.reply, /Reservations form/i);
});

test("completes the exact acceptance customer form with typed custom data", async (t) => {
  const previousGate = process.env.AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED;
  process.env.AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED = "true";
  t.after(() => {
    if (previousGate === undefined) delete process.env.AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED;
    else process.env.AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED = previousGate;
  });

  const session = {};
  const model = makeAttemptModel();
  let writes = 0;
  let request = null;
  const acceptanceReadAdapter = {
    ...readAdapter,
    async getCustomerForm() { return acceptanceForm; },
  };
  const send = async (message) => handleAiReservationConversation({
    context,
    session,
    message,
    model,
    readAdapter: acceptanceReadAdapter,
    contextResolver: async () => context,
    writeAdapter: {
      async createAppointment(bookingRequest) {
        writes += 1;
        request = bookingRequest;
        return { bookingId: "booking-1", reference: "BK-1" };
      },
    },
  });

  for (const message of [
    "I want to book an appointment",
    "1",
    "1",
    "2099-01-15",
    "1",
    "R2B Acceptance Test",
    "r2b-acceptance@example.com",
    "+601100000001",
    "R2B acceptance test notes",
    "Option A",
    "No",
    "10",
    "2026-09-22",
    "R2B controlled production acceptance test",
    "R2B test",
  ]) await send(message);

  assert.equal(session.reservationFlow.status, "awaiting_confirmation");
  const result = await send("yes");

  assert.equal(result.reservation.errorCode, null);
  assert.equal(result.reservation.flowStatus, "completed", JSON.stringify(result));
  assert.match(result.reply, /Reference: BK-1/);
  assert.equal(writes, 1);
  assert.equal(request.customData["acceptance-checkbox"], false);
  assert.equal(request.customData["acceptance-number"], 10);
  assert.equal(request.customData["acceptance-date"], "2026-09-22");
  assert.equal(session.reservationFlow.status, "completed");

  const replay = await send("yes");
  assert.equal(replay.handled, false);
  assert.equal(writes, 1);
});

test("rejects invalid custom input without advancing the active field", async () => {
  const session = {};
  const model = makeAttemptModel();
  const readAdapterWithDropdown = {
    ...readAdapter,
    async getCustomerForm() {
      return [{ id: "choice", label: "Choice", type: "dropdown", options: ["Option A", "Option B"], active: true }];
    },
  };
  const send = (message) => handleAiReservationConversation({
    context,
    session,
    message,
    model,
    readAdapter: readAdapterWithDropdown,
    contextResolver: async () => context,
  });

  for (const message of [
    "I want to book an appointment",
    "1",
    "1",
    "2099-01-15",
    "1",
    "Aisha",
    "aisha@example.com",
    "+31612345678",
  ]) await send(message);

  const invalid = await send("Option C");
  assert.match(invalid.reply, /Option A, Option B/);
  assert.equal(session.reservationFlow.status, "customer_form");
  assert.equal(session.reservationFlow.currentCustomField, "choice");
});

test("natural booking intent is deterministic and avoids informational false positives", () => {
  for (const message of [
    "I want to book", "I want to make a reservation", "I need an appointment",
    "Can I book a time?", "I'd like to schedule an appointment", "Schedule me in", "Can I make a booking?",
  ]) assert.equal(isGenericBookingIntent(message), true, message);
  for (const message of [
    "Can you recommend a book?", "Tell me about this book", "I booked this last year",
    "What is a booking reference?", "How does appointment scheduling work?", "Do you support bookings?",
  ]) assert.equal(isGenericBookingIntent(message), false, message);
  assert.equal(isNaturalServiceBookingIntent("I need a dental cleaning"), true);
});

test("generic booking starts typed service selection without Gemini", async () => {
  const session = {};
  const result = await handleAiReservationConversation({ context, session, message: "I want to book", readAdapter: multiServiceReadAdapter });
  assert.equal(result.handled, true);
  assert.equal(session.reservationFlow.status, "service_selection");
  assert.match(result.reply, /1\. Dental Cleaning/);
  assert.match(result.reply, /2\. Initial Consultation/);
});

test("natural service matching is exact, unique, and conservative", async () => {
  const exactSession = {};
  await handleAiReservationConversation({ context, session: exactSession, message: "I want to book Dental Cleaning", readAdapter: multiServiceReadAdapter });
  assert.equal(exactSession.reservationFlow.serviceId, 1);
  assert.equal(exactSession.reservationFlow.status, "provider_selection");

  const uniqueSession = {};
  await handleAiReservationConversation({ context, session: uniqueSession, message: "I need a cleaning", readAdapter: multiServiceReadAdapter });
  assert.equal(uniqueSession.reservationFlow.serviceId, 1);

  const ambiguousSession = {};
  const ambiguous = await handleAiReservationConversation({ context, session: ambiguousSession, message: "I need a consultation", readAdapter: multiServiceReadAdapter });
  assert.equal(ambiguousSession.reservationFlow.status, "service_selection");
  assert.equal(ambiguousSession.reservationFlow.serviceId, undefined);
  assert.match(ambiguous.reply, /Initial Consultation/);
  assert.match(ambiguous.reply, /Follow-up Consultation/);

  const unknownSession = {};
  const unknown = await handleAiReservationConversation({ context, session: unknownSession, message: "I want to book Massage", readAdapter: multiServiceReadAdapter });
  assert.equal(unknownSession.reservationFlow.status, "service_selection");
  assert.equal(unknownSession.reservationFlow.serviceId, undefined);
  assert.match(unknown.reply, /Dental Cleaning/);
});

test("cancel clears active typed flow without executing booking", async () => {
  const session = {
    reservationFlow: {
      status: "customer_form", serviceId: 1, providerId: 2, localDate: "2099-01-15",
      startsAt: "2099-01-15T09:00:00Z", customer: { name: "Aisha" }, customData: { answer: "old" },
      bookingAttemptId: "attempt-old", idempotencyKey: "key-old", confirmation: { required: true },
    },
  };
  let writes = 0;
  const result = await handleAiReservationConversation({
    context, session, message: "never mind", readAdapter,
    writeAdapter: { async createAppointment() { writes += 1; } },
  });
  assert.equal(result.handled, true);
  assert.equal(session.reservationFlow.status, "cancelled");
  assert.equal(session.reservationFlow.serviceId, null);
  assert.equal(session.reservationFlow.startsAt, null);
  assert.equal(session.reservationFlow.bookingAttemptId, null);
  assert.equal(writes, 0);
});

test("terminal and active restart requests create fresh flow state", async () => {
  for (const status of ["cancelled", "completed", "failed"]) {
    const session = { reservationFlow: { status, serviceId: 99, startsAt: "old", bookingAttemptId: "old-attempt" } };
    await handleAiReservationConversation({ context, session, message: "I want to book again", readAdapter: multiServiceReadAdapter });
    assert.equal(session.reservationFlow.status, "service_selection", status);
    assert.notEqual(session.reservationFlow.bookingAttemptId, "old-attempt", status);
    assert.equal(session.reservationFlow.serviceId, undefined, status);
  }
  const active = { reservationFlow: { status: "slot_selection", serviceId: 1, startsAt: "old", bookingAttemptId: "old-attempt" } };
  await handleAiReservationConversation({ context, session: active, message: "start over", readAdapter: multiServiceReadAdapter });
  assert.equal(active.reservationFlow.status, "service_selection");
  assert.equal(active.reservationFlow.startsAt, undefined);
  assert.notEqual(active.reservationFlow.bookingAttemptId, "old-attempt");
});

test("upstream provider and date changes invalidate dependent state", async () => {
  const providerSession = { reservationFlow: {
    status: "provider_selection", serviceId: 1, serviceSlug: "dental-cleaning", serviceName: "Dental Cleaning",
    selectionOptions: [{ id: 2, slug: "dr-a", displayName: "Dr A" }], localDate: "2099-01-15", startsAt: "old",
    customer: { name: "old" }, customData: { old: true }, bookingAttemptId: "old", confirmation: { required: true },
  } };
  await handleAiReservationConversation({ context, session: providerSession, message: "1", readAdapter });
  assert.equal(providerSession.reservationFlow.status, "date_selection");
  assert.equal(providerSession.reservationFlow.localDate, undefined);
  assert.equal(providerSession.reservationFlow.startsAt, undefined);
  assert.equal(providerSession.reservationFlow.bookingAttemptId, undefined);

  const dateSession = { reservationFlow: {
    status: "date_selection", serviceId: 1, providerId: 2, localDate: "2099-01-14", startsAt: "old", confirmation: { required: true },
  } };
  await handleAiReservationConversation({ context, session: dateSession, message: "2099-01-15", readAdapter });
  assert.equal(dateSession.reservationFlow.status, "slot_selection");
  assert.equal(dateSession.reservationFlow.startsAt, undefined);
  assert.equal(dateSession.reservationFlow.confirmation.required, undefined);
});
