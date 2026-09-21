import assert from "node:assert/strict";
import test from "node:test";
import { handleAiReservationConversation } from "../services/aiReservationConversationService.js";

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

const acceptanceForm = [
  { id: "acceptance-textarea", label: "Acceptance Textarea", type: "textarea", active: true },
  { id: "acceptance-dropdown", label: "Acceptance Dropdown", type: "dropdown", options: ["Option A", "Option B"], active: true },
  { id: "acceptance-checkbox", label: "Acceptance Checkbox", type: "checkbox", active: true },
  { id: "acceptance-number", label: "Acceptance Number", type: "number", active: true },
  { id: "acceptance-date", label: "Acceptance Date", type: "date", active: true },
  { id: "special-requests", label: "Special requests", type: "text", active: true },
  { id: "acceptance-reason", label: "acceptance reason 2", type: "text", active: true },
];

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
