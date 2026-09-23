import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const { mock } = await import("node:test");
const {
  askGemini,
  isReservationCapabilityQuestion,
  isReservationServiceListQuestion,
  shouldHandleTypedAppointment,
} = await import("../controllers/chatbotController.js");
const { reservationsReadAdapter } = await import("../services/reservationReadAdapter.js");

const chatbotId = "chatbot-1";
const companyId = "company-1";

const makeRequestContext = ({ bookingBehavior = "immediate", reservationEnabled = true } = {}) => {
  const session = {
    sessionId: "session-1",
    chatbotId,
    chatLogs: [],
    reservationFlow: undefined,
    async save() {},
  };
  return {
    settings: {
      _id: chatbotId,
      apiKey: "test-api-key",
      companyId,
      geminiKey: "must-not-be-called",
      gemini_model: "must-not-be-called",
      reservationEnabled,
    },
    company: {
      _id: companyId,
      reservationBusinessId: 42,
      reservationBusinessSlug: "tenant-a",
      isActive: true,
    },
    installation: { _id: "installation-1", companyId },
    reservationContext: {
      sessionId: "session-1",
      chatbotId,
      companyId,
      reservationBusinessId: 42,
      reservationBusinessSlug: "tenant-a",
      configuration: {
        templateKey: "general",
        capabilities: { services: true },
        terminology: {},
        bookingBehavior: { booking_behavior: bookingBehavior },
      },
    },
    session,
  };
};

const send = async (message, options = {}) => {
  const requestContext = makeRequestContext(options);
  const response = { json(body) { this.body = body; } };
  await askGemini({
    body: {
      sessionId: "session-1",
      chatbotId,
      message,
      chatHistory: [],
      isPreview: true,
    },
    headers: { "x-api-key": "test-api-key" },
    chatRequestContext: requestContext,
  }, response, (error) => { throw error; });
  return { response: response.body, session: requestContext.session };
};

test("capability questions are classified informationally without starting typed R2B", () => {
  for (const message of [
    "How does booking work?",
    "How do reservations work?",
    "Can I book here?",
    "Can I make a reservation here?",
    "Do you take reservations?",
    "What services can I book?",
    "Which services can I book?",
    "What can I book?",
  ]) {
    assert.equal(isReservationCapabilityQuestion(message), true, message);
  }
  assert.equal(isReservationServiceListQuestion("What services can I book?"), true);
  assert.equal(isReservationServiceListQuestion("How does booking work?"), false);
});

test("direct-booking capability answer is deterministic and does not call Gemini", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Gemini must not be called"); };
  try {
    for (const message of ["How does booking work?", "How do reservations work?", "Can I book here?", "Do you take reservations?"]) {
      const { response, session } = await send(message);
      assert.match(response.reply, /book an available service directly here in chat/i, message);
      assert.equal(session.reservationFlow, undefined, message);
      assert.equal(response.reservation, undefined, message);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Can I make a reservation here? returns an informational capability answer", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Gemini must not be called"); };
  try {
    const { response, session } = await send("Can I make a reservation here?");
    assert.match(response.reply, /book an available service directly here in chat/i);
    assert.doesNotMatch(response.reply, /dashboard|Reservations form|meeting|callback/i);
    assert.equal(session.reservationFlow, undefined);
    assert.equal(response.reservation, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("service capability answers use only canonical configured services", async (t) => {
  t.mock.method(reservationsReadAdapter, "listBookableServices", async () => [
    { id: "service-1", name: "Acceptance Test Service" },
    { id: "service-2", name: "Example Service" },
  ]);
  const { response, session } = await send("What services can I book?");
  assert.match(response.reply, /1\. Acceptance Test Service/);
  assert.match(response.reply, /2\. Example Service/);
  assert.doesNotMatch(response.reply, /synthetic|strategic discussion|schedule a meeting/i);
  assert.equal(session.reservationFlow, undefined);
});

for (const message of ["Which services can I book?", "What can I book?"]) {
  test(`${message} returns the canonical service catalogue without starting a flow`, async (t) => {
    t.mock.method(reservationsReadAdapter, "listBookableServices", async () => [
      { id: "service-1", name: "Acceptance Test Service" },
      { id: "service-2", name: "Example Service" },
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("Gemini must not be called"); };
    try {
      const { response, session } = await send(message);
      assert.match(response.reply, /1\. Acceptance Test Service/);
      assert.match(response.reply, /2\. Example Service/);
      assert.doesNotMatch(response.reply, /synthetic|strategic discussion|schedule a meeting/i);
      assert.equal(session.reservationFlow, undefined);
      assert.equal(response.reservation, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("service catalogue read failure returns a safe deterministic response", async (t) => {
  t.mock.method(reservationsReadAdapter, "listBookableServices", async () => {
    throw new Error("internal service read details");
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Gemini must not be called"); };
  try {
    const { response, session } = await send("What services can I book?");
    assert.match(response.reply, /can.t confirm the current booking options|Reservations form/i);
    assert.doesNotMatch(response.reply, /internal service read details|Acceptance Test Service|Example Service/i);
    assert.equal(session.reservationFlow, undefined);
    assert.equal(response.reservation, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("empty service catalogue returns a clear no-services response", async (t) => {
  t.mock.method(reservationsReadAdapter, "listBookableServices", async () => []);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Gemini must not be called"); };
  try {
    const { response, session } = await send("What services can I book?");
    assert.match(response.reply, /no bookable services|no services are currently available|not currently available/i);
    assert.doesNotMatch(response.reply, /couldn.t load|try again shortly/i);
    assert.doesNotMatch(response.reply, /book an available service directly|Acceptance Test Service|Example Service/i);
    assert.equal(session.reservationFlow, undefined);
    assert.equal(response.reservation, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("request-only empty service catalogue uses request-specific wording", async (t) => {
  t.mock.method(reservationsReadAdapter, "listBookableServices", async () => []);
  const { response, session } = await send("What services can I book?", { bookingBehavior: "request" });
  assert.match(response.reply, /no reservation-request services are currently available/i);
  assert.doesNotMatch(response.reply, /couldn.t load|try again shortly|book an available service directly/i);
  assert.equal(session.reservationFlow, undefined);
  assert.equal(response.reservation, undefined);
});

test("request-only capability answers do not claim direct booking", async () => {
  const { response, session } = await send("How does booking work?", { bookingBehavior: "request" });
  assert.match(response.reply, /reservation requests/i);
  assert.doesNotMatch(response.reply, /directly here in chat|confirmed booking/i);
  assert.equal(session.reservationFlow, undefined);
});

test("request-only service lists preserve request semantics", async (t) => {
  t.mock.method(reservationsReadAdapter, "listBookableServices", async () => [
    { id: "service-1", name: "Acceptance Test Service" },
  ]);
  const { response, session } = await send("What services can I book?", { bookingBehavior: "request" });
  assert.match(response.reply, /Acceptance Test Service/);
  assert.match(response.reply, /service you’d like to request/i);
  assert.doesNotMatch(response.reply, /service you’d like to book/i);
  assert.equal(session.reservationFlow, undefined);
});

test("disabled Reservations capability uses a safe fallback", async () => {
  const { response, session } = await send("How does booking work?", { reservationEnabled: false });
  assert.match(response.reply, /not available/i);
  assert.doesNotMatch(response.reply, /book an available service directly/i);
  assert.equal(session.reservationFlow, undefined);
});

test("Patch 4B.0 transactional and callback routing remains distinct", () => {
  assert.equal(shouldHandleTypedAppointment({ reservationEnabled: true, message: "booking", session: {} }), true);
  assert.equal(shouldHandleTypedAppointment({ reservationEnabled: true, message: "test service", session: {} }), true);
  assert.equal(shouldHandleTypedAppointment({ reservationEnabled: true, message: "request callback", session: {} }), false);
  assert.equal(shouldHandleTypedAppointment({ reservationEnabled: true, message: "video meeting", session: {} }), false);
});
