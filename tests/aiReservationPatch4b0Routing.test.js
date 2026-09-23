import assert from "node:assert/strict";
import test from "node:test";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const {
  handleAiReservationConversation,
  isGenericBookingIntent,
  isNaturalServiceBookingIntent,
} = await import("../services/aiReservationConversationService.js");
const { shouldHandleTypedAppointment } = await import("../controllers/chatbotController.js");

const context = {
  companyId: "company-1",
  chatbotId: "chatbot-1",
  sessionId: "session-1",
  reservationBusinessId: 42,
  reservationBusinessSlug: "tenant-a",
  configuration: { templateKey: "general", capabilities: { services: true }, bookingBehavior: { booking_behavior: "immediate" } },
};

const services = [
  { id: "service-1", slug: "acceptance-test-service", name: "Acceptance Test Service" },
  { id: "service-2", slug: "acceptance-test-session", name: "Acceptance Test Session" },
];

const readAdapter = {
  async listBookableServices() { return services; },
  async listBookableProviders() { return [{ id: "provider-1", slug: "dr-a", displayName: "Dr A" }]; },
  async listAppointmentAvailability() { return []; },
  async getCustomerForm() { return []; },
};

test("generic booking vocabulary is deterministic and does not use Gemini", () => {
  for (const message of ["book", "booking", "reservation", "reserve", "make a reservation", "book a service", "schedule a service"]) {
    assert.equal(isGenericBookingIntent(message) || isNaturalServiceBookingIntent(message), true, message);
    assert.equal(shouldHandleTypedAppointment({ reservationEnabled: true, message, session: {} }), true, message);
  }
  for (const message of ["request callback", "call me", "video meeting", "online meeting", "Google Meet", "Zoom meeting"]) {
    assert.equal(shouldHandleTypedAppointment({ reservationEnabled: true, message, session: {} }), false, message);
  }
});

test("informational reservation questions do not start typed booking", () => {
  for (const message of ["How does booking work?", "What is your reservation policy?", "Can I cancel a reservation?", "What services can I book?", "Do you take reservations?"]) {
    assert.equal(shouldHandleTypedAppointment({ reservationEnabled: true, message, session: {} }), false, message);
    assert.equal(isGenericBookingIntent(message), false, message);
  }
});

test("generic booking starts the typed service-selection flow without a model", async () => {
  for (const message of ["book", "booking", "reservation", "make a reservation"]) {
    const session = { bookingType: "clarify", reservationStep: "askDate" };
    const result = await handleAiReservationConversation({
      context,
      session,
      message,
      readAdapter,
      model: { async generateContent() { throw new Error("Gemini must not be called"); } },
    });
    assert.equal(result.handled, true, message);
    assert.equal(session.reservationFlow.status, "service_selection", message);
    assert.equal(session.bookingType, "clarify", "direct orchestration does not own legacy cleanup");
  }
});

test("unique service-name starts select the canonical service", async () => {
  for (const message of ["test service", "acceptance test service"]) {
    const session = {};
    const result = await handleAiReservationConversation({ context, session, message, readAdapter });
    assert.equal(result.handled, true, message);
    assert.equal(session.reservationFlow.serviceId, "service-1", message);
    assert.equal(session.reservationFlow.status, "provider_selection", message);
  }
});

test("ambiguous service-name starts clarify without guessing", async () => {
  const session = {};
  const result = await handleAiReservationConversation({ context, session, message: "acceptance test", readAdapter });
  assert.equal(session.reservationFlow.status, "service_selection");
  assert.equal(session.reservationFlow.serviceId, undefined);
  assert.match(result.reply, /more than one match|1\./i);
});

test("unknown service-like text is not treated as a canonical service", async () => {
  const session = {};
  const result = await handleAiReservationConversation({ context, session, message: "unknown service", readAdapter });
  assert.equal(result.handled, false);
  assert.equal(session.reservationFlow, undefined);
});
