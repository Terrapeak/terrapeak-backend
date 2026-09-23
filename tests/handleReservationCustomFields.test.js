import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const { mock } = await import("node:test");
const { default: handleReservationCustomFields } = await import("../middleware/handleReservationCustomFields.js");
const { handleAiReservationConversation } = await import("../services/aiReservationConversationService.js");
const { default: ChatbotSettings } = await import("../models/chatbotSettings.js");
const { default: Session } = await import("../models/sessionModel.js");
const { default: Company } = await import("../models/company.js");
const { default: CompanyAppInstallation } = await import("../models/companyAppInstallation.js");

const settings = { _id: "chatbot-1", companyId: "company-1", reservationEnabled: true };

const queryChain = (value) => ({
  select() { return this; },
  lean: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

const installMocks = (t, session) => {
  mock.method(ChatbotSettings, "findOne", () => ({ select: async () => settings }));
  mock.method(Session, "findOne", async () => session);
  mock.method(Company, "findById", () => queryChain({
    reservationBusinessId: 42,
    reservationTemplate: "general",
    isActive: true,
  }));
  mock.method(CompanyAppInstallation, "findOne", () => queryChain({ _id: "installation-1" }));
  t.after(() => mock.restoreAll());
};

const invoke = async (session, message, chatReservationContext = null) => {
  const response = { body: null, json(body) { this.body = body; return body; } };
  let nextCalled = false;
  await handleReservationCustomFields(
    {
      body: { sessionId: "session-1", chatbotId: "chatbot-1", message },
      headers: { "x-api-key": "test-key" },
      ...(chatReservationContext ? { chatReservationContext } : {}),
    },
    response,
    () => { nextCalled = true; },
  );
  return { response, nextCalled };
};

test("fresh typed booking start bypasses stale legacy askDate state", async (t) => {
  const session = {
    chatLogs: [],
    bookingType: "reservation",
    reservationStep: "askDate",
    reservationFlow: null,
    async save() { throw new Error("fresh typed start must not save through legacy middleware"); },
  };
  installMocks(t, session);

  const { response, nextCalled } = await invoke(session, "I want to book", { reservationBusinessId: 42 });

  assert.equal(nextCalled, true);
  assert.equal(response.body, null);
  assert.equal(session.reservationStep, "askDate");
});

test("active R2B flow bypasses stale legacy askDate state", async (t) => {
  const session = {
    chatLogs: [],
    bookingType: "reservation",
    reservationStep: "askDate",
    reservationDate: "2099-01-15",
    reservationFlow: { status: "awaiting_confirmation", journeyType: "appointment" },
    async save() { throw new Error("typed flow should not save through legacy middleware"); },
  };
  installMocks(t, session);

  const { response, nextCalled } = await invoke(session, "yes");

  assert.equal(nextCalled, true);
  assert.equal(response.body, null);
  assert.equal(session.reservationFlow.status, "awaiting_confirmation");
  assert.equal(session.reservationStep, "askDate");
});

test("terminal typed R2B states also bypass stale legacy state", async (t) => {
  for (const status of ["completed", "cancelled", "failed"]) {
    const session = {
      chatLogs: [],
      bookingType: "reservation",
      reservationStep: "askCustomField",
      reservationFlow: { status, journeyType: "appointment" },
      async save() { throw new Error("terminal typed flow should not enter legacy middleware"); },
    };
    installMocks(t, session);
    const { response, nextCalled } = await invoke(session, "yes");
    assert.equal(nextCalled, true, status);
    assert.equal(response.body, null, status);
  }
});

test("legacy askDate still handles sessions without a typed flow", async (t) => {
  const session = {
    chatLogs: [],
    bookingType: "reservation",
    reservationStep: "askDate",
    reservationFlow: null,
    async save() {},
  };
  installMocks(t, session);

  const { response, nextCalled } = await invoke(session, "2099-01-15");

  assert.equal(nextCalled, false);
  assert.match(response.body.reply, /What time would you like/);
  assert.equal(session.reservationDate, "2099-01-15");
  assert.equal(session.reservationStep, "askTime");
});

test("the post-middleware final yes reaches the typed confirmation handler", async (t) => {
  const session = {
    chatLogs: [],
    bookingType: "reservation",
    reservationStep: "askDate",
    reservationFlow: {
      status: "awaiting_confirmation",
      journeyType: "appointment",
      confirmation: { summary: { serviceName: "Acceptance Test Service" } },
    },
    async save() { throw new Error("typed flow should not save through legacy middleware"); },
  };
  installMocks(t, session);

  const { response, nextCalled } = await invoke(session, "yes");
  assert.equal(nextCalled, true);
  assert.equal(response.body, null);

  const events = [];
  const originalInfo = console.info;
  console.info = (value) => events.push(JSON.parse(value));
  const previousGate = process.env.AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED;
  process.env.AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED = "false";
  try {
    const result = await handleAiReservationConversation({
      context: {
        companyId: "company-1",
        chatbotId: "chatbot-1",
        reservationBusinessId: 42,
        configuration: { bookingBehavior: { booking_behavior: "immediate" } },
      },
      session,
      message: "yes",
    });
    assert.equal(result.handled, true);
    assert.equal(result.reservation.errorCode, "TRANSACTIONAL_BOOKING_DISABLED");
  } finally {
    console.info = originalInfo;
    if (previousGate === undefined) delete process.env.AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED;
    else process.env.AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED = previousGate;
  }

  assert.deepEqual(events.map(({ event }) => event), [
    "reservation_confirmation_received",
    "reservation_transaction_gate_checked",
    "reservation_booking_gate_blocked",
    "reservation_performance_stage",
  ]);
});
