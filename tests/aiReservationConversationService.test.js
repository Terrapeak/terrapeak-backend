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
