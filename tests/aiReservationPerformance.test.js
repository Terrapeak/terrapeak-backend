import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { handleAiReservationConversation } from "../services/aiReservationConversationService.js";

const context = {
  companyId: "company-1",
  chatbotId: "chatbot-1",
  sessionId: "session-1",
  reservationBusinessId: 42,
  reservationBusinessSlug: "tenant-a",
  configuration: {
    templateKey: "general",
    capabilities: { services: true },
    bookingBehavior: { booking_behavior: "immediate" },
  },
};

test("R2B collection profile records deterministic dependency calls per turn", async () => {
  const calls = {
    services: 0,
    providers: 0,
    availability: 0,
    customerForm: 0,
    mongoFind: 0,
    mongoCreate: 0,
    turns: [],
  };
  const readAdapter = {
    async listBookableServices() {
      calls.services += 1;
      return [{ id: "service-1", slug: "consultation", name: "Consultation" }];
    },
    async listBookableProviders() {
      calls.providers += 1;
      return [{ id: "provider-1", slug: "dr-a", displayName: "Dr A" }];
    },
    async listAppointmentAvailability() {
      calls.availability += 1;
      return [{ startsAt: "2099-01-15T09:00:00.000Z", localTime: "09:00", timezone: "UTC" }];
    },
    async getCustomerForm() {
      calls.customerForm += 1;
      return [];
    },
  };
  const model = {
    async findOne() {
      calls.mongoFind += 1;
      return null;
    },
    async create(value) {
      calls.mongoCreate += 1;
      return value;
    },
  };
  const session = {};
  const send = async (message) => {
    const started = performance.now();
    const result = await handleAiReservationConversation({ context, session, message, readAdapter, model });
    calls.turns.push({ message, durationMs: Number((performance.now() - started).toFixed(3)) });
    return result;
  };

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

  assert.equal(session.reservationFlow.status, "awaiting_confirmation");
  assert.equal(calls.services, 1);
  assert.equal(calls.providers, 1);
  assert.equal(calls.availability, 1);
  assert.equal(calls.customerForm, 1);
  assert.equal(calls.mongoCreate, 1);
  assert.equal(calls.mongoFind, 1);
  assert.equal(calls.turns.length, 8);
});
