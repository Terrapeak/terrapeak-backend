import assert from "node:assert/strict";
import test from "node:test";
import {
  handleAiReservationConversation,
  isReservationDomainIntent,
} from "../services/aiReservationConversationService.js";

const makeContext = (templateKey, capabilities, terminology = {}) => ({
  companyId: "company-1",
  chatbotId: "chatbot-1",
  sessionId: "session-1",
  reservationBusinessId: 42,
  reservationBusinessSlug: "tenant-a",
  configuration: {
    templateKey,
    capabilities,
    terminology,
    bookingBehavior: { booking_behavior: "immediate" },
  },
});

const learningContext = makeContext(
  "learning_centre",
  { services: true, teamResources: true, scheduledSessions: true, packages: true, guestCount: false },
  { servicePlural: "Classes", guestPlural: "Students" },
);

const appointmentContext = makeContext(
  "general",
  { services: true, teamResources: true, scheduledSessions: false, packages: false, guestCount: false },
);

const restaurantContext = makeContext(
  "restaurant",
  { services: false, teamResources: false, scheduledSessions: false, packages: false, guestCount: true },
  { guestPlural: "Guests" },
);

const learningReadAdapter = {
  async listBookableServices() {
    return [
      { id: 1, slug: "maths", name: "Mathematics Class", packageSessionCount: 10, packageValidityDays: 90 },
      { id: 2, slug: "reading", name: "Reading Class" },
    ];
  },
  async listScheduledSessions(_context, { serviceSlug }) {
    if (serviceSlug !== "maths") return [];
    return [{ id: "session-1", serviceId: 1, startsAt: "2026-10-01T09:00:00.000Z", staffName: "Teacher A" }];
  },
};

const noGemini = () => {
  throw new Error("Gemini must not be called for deterministic capability handling");
};

test("reservation-domain classifier recognizes classes, packages, and restaurant party size", () => {
  for (const message of [
    "what classes can I book",
    "what sessions are available",
    "do you have classes",
    "do you offer packages",
    "what packages do you have",
    "reserve a table tomorrow for 4 people",
    "booking for 2 guests",
  ]) assert.equal(isReservationDomainIntent(message), true, message);
  assert.equal(isReservationDomainIntent("We have 4 people in our sales team"), false);
  assert.equal(isReservationDomainIntent("Can you book a meeting with your consultant?"), false);
});

test("Learning Centre class information is deterministic and uses scheduled-session data", async () => {
  const result = await handleAiReservationConversation({
    context: learningContext,
    session: {},
    message: "What classes can I book?",
    readAdapter: learningReadAdapter,
    model: { generate: noGemini },
  });
  assert.equal(result.handled, true);
  assert.match(result.reply, /Available classes/i);
  assert.match(result.reply, /Mathematics Class/);
  assert.match(result.reply, /Teacher A/);
  assert.equal(result.reservation.journeyType, "scheduled_session");
});

test("Learning Centre package information is deterministic and grounded in service metadata", async () => {
  const result = await handleAiReservationConversation({
    context: learningContext,
    session: {},
    message: "Do you offer packages?",
    readAdapter: learningReadAdapter,
    model: { generate: noGemini },
  });
  assert.equal(result.handled, true);
  assert.match(result.reply, /Available package options/);
  assert.match(result.reply, /Mathematics Class/);
  assert.match(result.reply, /10 session/);
});

test("enabled capabilities without configured package or session data do not fabricate options", async () => {
  const result = await handleAiReservationConversation({
    context: learningContext,
    session: {},
    message: "What sessions are available?",
    readAdapter: {
      async listBookableServices() { return [{ id: 1, slug: "class", name: "Class" }]; },
      async listScheduledSessions() { return []; },
    },
    model: { generate: noGemini },
  });
  assert.match(result.reply, /No bookable classes or scheduled sessions/i);
});

test("restaurant reservation intent enters typed guest/date flow without appointment service flow or writing", async () => {
  let serviceReads = 0;
  let writes = 0;
  const result = await handleAiReservationConversation({
    context: restaurantContext,
    session: {},
    message: "Can I make a reservation for 4 guests?",
    readAdapter: {
      async listBookableServices() { serviceReads += 1; return []; },
    },
    writeAdapter: { async createAppointment() { writes += 1; } },
    model: { generate: noGemini },
  });
  assert.equal(result.handled, true);
  assert.match(result.reply, /what date/i);
  assert.doesNotMatch(result.reply, /choose a service/i);
  assert.equal(result.reservation.journeyType, "restaurant");
  assert.equal(result.reservation.step, "date_selection");
  assert.equal(serviceReads, 0);
  assert.equal(writes, 0);
});

test("disabled class and package capabilities are not advertised", async () => {
  const result = await handleAiReservationConversation({
    context: appointmentContext,
    session: {},
    message: "Do you offer packages?",
    readAdapter: {
      async listBookableServices() { throw new Error("service read should not be needed"); },
    },
    model: { generate: noGemini },
  });
  assert.match(result.reply, /not enabled/i);
});

test("ordinary appointment tenants do not enter a restaurant journey for guest wording", async () => {
  const result = await handleAiReservationConversation({
    context: appointmentContext,
    session: {},
    message: "Can I reserve for 6 guests?",
    readAdapter: { async listBookableServices() { return []; } },
    model: { generate: noGemini },
  });
  assert.equal(result.reservation.journeyType, null);
  assert.match(result.reply, /not enabled/i);
});
