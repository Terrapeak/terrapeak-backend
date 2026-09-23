import test from "node:test";
import assert from "node:assert/strict";
import Session from "../models/sessionModel.js";
import { resolveAiReservationOption } from "../utils/aiReservationOptionResolver.js";
import { normalizeStructuredDateInput, parseCustomerFormInput } from "../utils/aiReservationCustomerForm.js";
import { buildReservationConfirmationSummary, formatReservationConfirmationSummary, formatReservationSuccessResponse } from "../services/aiReservationFlowService.js";
import { sendAiReservationConfirmationEmail } from "../services/aiReservationConfirmationEmailService.js";
import { executeAiReservationBooking } from "../services/aiReservationBookingService.js";
import { handleAiReservationConversation } from "../services/aiReservationConversationService.js";
import { fingerprintReservationBookingRequest } from "../utils/reservationRequestFingerprint.js";

const bookingContext = {
  companyId: "company-1",
  chatbotId: "chatbot-1",
  sessionId: "session-1",
  reservationBusinessId: 42,
  reservationBusinessSlug: "tenant-a",
  configuration: { templateKey: "general", capabilities: { services: true }, bookingBehavior: { booking_behavior: "immediate" } },
};

const bookingFlow = {
  status: "awaiting_confirmation",
  journeyType: "appointment",
  companyId: "company-1",
  chatbotId: "chatbot-1",
  businessId: "42",
  bookingAttemptId: "attempt-1",
  idempotencyKey: "company-1:attempt-1",
  serviceId: "service-1",
  serviceSlug: "consultation",
  providerId: "provider-1",
  providerSlug: "dr-a",
  localDate: "2099-01-15",
  localTime: "09:00",
  startsAt: "2099-01-15T09:00:00.000Z",
  timezone: "UTC",
  customer: { name: "Aisha", email: "aisha@example.com", phone: "+31612345678" },
  customData: {},
  confirmation: {
    summary: {
      serviceName: "Consultation",
      providerName: "Dr A",
      localDate: "2099-01-15",
      localTime: "09:00",
      timezone: "UTC",
      customer: { name: "Aisha", email: "aisha@example.com", phone: "+31612345678" },
    },
  },
};

const bookingFingerprint = fingerprintReservationBookingRequest({
  reservationBusinessSlug: "tenant-a",
  serviceSlug: "consultation",
  providerSlug: "dr-a",
  startsAt: bookingFlow.startsAt,
  customerName: "Aisha",
  customerEmail: "aisha@example.com",
  customerPhone: "+31612345678",
  customData: {},
}).fingerprint;

const getPath = (value, path) => path.split(".").reduce((current, key) => current?.[key], value);
const setPath = (value, path, next) => {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((current, key) => {
    current[key] ||= {};
    return current[key];
  }, value);
  target[last] = next;
};
const matchesQuery = (row, query = {}) => Object.entries(query).every(([key, expected]) => {
  if (key === "$or") return expected.some((candidate) => matchesQuery(row, candidate));
  const actual = getPath(row, key);
  if (expected && typeof expected === "object" && "$in" in expected) return expected.$in.includes(actual);
  if (expected && typeof expected === "object" && "$exists" in expected) return (actual !== undefined) === expected.$exists;
  return String(actual) === String(expected);
});

const makeAtomicAttemptModel = (initial, onUpdate = () => {}) => {
  const rows = [initial];
  return {
    rows,
    async findOne(query) { return rows.find((row) => matchesQuery(row, query)) || null; },
    async findOneAndUpdate(query, update) {
      const row = rows.find((candidate) => matchesQuery(candidate, query));
      if (!row) return null;
      onUpdate(query, update);
      for (const [key, value] of Object.entries(update.$set || {})) setPath(row, key, value);
      for (const [key, value] of Object.entries(update.$inc || {})) setPath(row, key, (getPath(row, key) || 0) + value);
      return row;
    },
  };
};

const makeBookingReadAdapter = () => ({
  async listBookableServices() { return [{ id: "service-1", slug: "consultation", name: "Consultation" }]; },
  async listBookableProviders() { return [{ id: "provider-1", slug: "dr-a", displayName: "Dr A" }]; },
  async listAppointmentAvailability() { return [{ startsAt: bookingFlow.startsAt, endsAt: "2099-01-15T10:00:00.000Z" }]; },
  async getCustomerForm() { return []; },
});

const withoutEmailConfiguration = () => {
  const names = ["RESEND_API_KEY", "EMAIL_USER", "EMAIL_PASS"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
  return () => names.forEach((name) => {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  });
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("Patch 4A persists local time in the typed session schema", () => {
  assert.ok(Session.schema.path("reservationFlow.localTime"));
});

test("deterministic option matching supports exact, ordinal, unique partial, and safe ambiguity", () => {
  const options = [
    { name: "Acceptance Test Team Member" },
    { name: "Test math Jane Lin" },
  ];
  assert.equal(resolveAiReservationOption("1", options).option, options[0]);
  assert.equal(resolveAiReservationOption("acceptance test", options).option, options[0]);
  assert.equal(resolveAiReservationOption("test team", options).option, options[0]);
  assert.equal(resolveAiReservationOption("test", options).status, "ambiguous");
  assert.equal(resolveAiReservationOption("unknown", options).status, "none");
});

test("structured dates normalize safe separators and reject malformed calendar dates", () => {
  assert.deepEqual(normalizeStructuredDateInput("2026.09.24"), { valid: true, value: "2026-09-24", message: null });
  assert.deepEqual(normalizeStructuredDateInput("2026/09/24"), { valid: true, value: "2026-09-24", message: null });
  assert.equal(normalizeStructuredDateInput("2026 09 24").valid, false);
  assert.match(normalizeStructuredDateInput("2026-02-30").message, /valid calendar date/);
});

test("unsupported date separators are rejected without advancing the date flow", async () => {
  for (const value of ["2026:09:24", "2026 09 24"]) {
    const parsed = parseCustomerFormInput({ type: "date", label: "Appointment date" }, value);
    assert.equal(parsed.valid, false, value);
    assert.match(parsed.message, /YYYY-MM-DD/);
  }
  let availabilityCalls = 0;
  const session = { reservationFlow: { status: "date_selection", serviceId: "service-1", serviceSlug: "consultation", providerId: "provider-1", providerSlug: "dr-a" } };
  const result = await handleAiReservationConversation({
    context: bookingContext,
    session,
    message: "2026:09:24",
    readAdapter: { ...makeBookingReadAdapter(), async listAppointmentAvailability() { availabilityCalls += 1; return []; } },
  });
  assert.equal(session.reservationFlow.status, "date_selection");
  assert.equal(availabilityCalls, 0);
  assert.match(result.reply, /YYYY-MM-DD/);
});

test("ambiguous provider clarification is recoverable and preserves the selected service", async () => {
  let writes = 0;
  let modelCalls = 0;
  const session = {
    reservationFlow: {
      status: "provider_selection",
      serviceId: "service-1",
      serviceSlug: "consultation",
      serviceName: "Consultation",
      selectionOptions: [
        { id: "provider-1", slug: "acceptance-test-team-member", displayName: "Acceptance Test Team Member" },
        { id: "provider-2", slug: "test-math-jane-lin", displayName: "Test math Jane Lin" },
      ],
      customer: { name: "Aisha" },
      customData: { note: "preserve" },
    },
  };
  const readAdapter = {
    ...makeBookingReadAdapter(),
    async listBookableProviders() { return session.reservationFlow.selectionOptions; },
  };
  const ambiguous = await handleAiReservationConversation({ context: bookingContext, session, message: "test", readAdapter, model: { async findOne() { modelCalls += 1; return null; } }, writeAdapter: { async createAppointment() { writes += 1; } } });
  assert.match(ambiguous.reply, /more than one match/i);
  assert.equal(session.reservationFlow.status, "provider_selection");
  assert.equal(session.reservationFlow.serviceId, "service-1");
  assert.equal(session.reservationFlow.providerId, undefined);
  assert.deepEqual(session.reservationFlow.customer, { name: "Aisha" });
  assert.deepEqual(session.reservationFlow.customData, { note: "preserve" });
  assert.equal(modelCalls, 0);
  assert.equal(writes, 0);

  const resolved = await handleAiReservationConversation({ context: bookingContext, session, message: "Acceptance Test Team Member", readAdapter, writeAdapter: { async createAppointment() { writes += 1; } } });
  assert.equal(session.reservationFlow.providerId, "provider-1");
  assert.equal(session.reservationFlow.providerName, "Acceptance Test Team Member");
  assert.equal(session.reservationFlow.serviceId, "service-1");
  assert.equal(session.reservationFlow.status, "date_selection");
  assert.equal(resolved.handled, true);
  assert.equal(writes, 0);
});

test("dropdown shorthand A resolves to the canonical value and ambiguous shorthand stays unresolved", async () => {
  const field = { id: "choice", label: "Preference", type: "dropdown", options: ["Option A", "Option B"], required: true, active: true };
  const session = {
    reservationFlow: {
      status: "customer_form",
      serviceId: "service-1",
      serviceSlug: "consultation",
      providerId: "provider-1",
      providerSlug: "dr-a",
      localDate: "2099-01-15",
      startsAt: "2099-01-15T09:00:00.000Z",
      localTime: "09:00",
      timezone: "UTC",
      customer: { name: "Aisha", email: "aisha@example.com", phone: "+31612345678" },
      customData: {},
      customerFormSnapshot: [field, { id: "notes", label: "Notes", type: "text", required: false, active: true }],
      customFieldIndex: 0,
      currentCustomField: "choice",
      formFieldIndex: 3,
    },
  };
  let modelCalls = 0;
  const resolved = await handleAiReservationConversation({
    context: bookingContext,
    session,
    message: "A",
    model: { async findOne() { modelCalls += 1; return null; } },
    readAdapter: makeBookingReadAdapter(),
  });
  assert.equal(session.reservationFlow.customData.choice, "Option A");
  assert.notEqual(session.reservationFlow.customData.choice, "A");
  assert.equal(session.reservationFlow.currentCustomField, "notes");
  assert.equal(session.reservationFlow.customFieldIndex, 1);
  assert.equal(resolved.handled, true);
  assert.equal(modelCalls, 0);

  const lowerCaseSession = structuredClone(session);
  lowerCaseSession.reservationFlow.customData = {};
  lowerCaseSession.reservationFlow.customFieldIndex = 0;
  lowerCaseSession.reservationFlow.currentCustomField = "choice";
  await handleAiReservationConversation({ context: bookingContext, session: lowerCaseSession, message: "a", readAdapter: makeBookingReadAdapter() });
  assert.equal(lowerCaseSession.reservationFlow.customData.choice, "Option A");

  const ambiguous = parseCustomerFormInput({ ...field, options: ["Option A", "Alternative A"] }, "A");
  assert.equal(ambiguous.valid, false);
  assert.match(ambiguous.message, /more than one match/i);
  assert.doesNotMatch(ambiguous.message, /Option A was selected/i);
});

test("confirmation summary includes core contact fields without duplicating system fields", () => {
  const summary = buildReservationConfirmationSummary({
    context: { reservationBusinessId: "42", reservationBusinessSlug: "tenant-a", configuration: {} },
    flow: { serviceId: "s", providerId: "p", localDate: "2026-09-24", localTime: "09:00", quantity: 1 },
    service: { id: "s", slug: "service", name: "Massage" },
    provider: { id: "p", slug: "provider", displayName: "Dr A" },
    slot: { startsAt: "2026-09-24T01:00:00.000Z", localTime: "09:00", timezone: "Asia/Singapore" },
    customer: { name: "Aisha", email: "aisha@example.com", phone: "+60123456789" },
    form: [{ id: "name", label: "Name", systemKey: "name" }, { id: "notes", label: "Notes" }],
  });
  const text = formatReservationConfirmationSummary({ ...summary, customFields: [{ label: "Notes", value: "First visit" }] });
  assert.match(text, /Email: aisha@example\.com/);
  assert.match(text, /Phone: \+60123456789/);
  assert.doesNotMatch(text, /Additional details:[\s\S]*Name:/);
});

test("booking summaries use paragraph-separated Markdown blocks without changing values", () => {
  const summary = {
    serviceName: "Acceptance Test Service",
    providerName: "Acceptance Test Team Member",
    localDate: "2026-09-24",
    localTime: "09:00",
    customer: { name: "Tim Harmsen", email: "tim@test.com", phone: "1234567" },
    customFields: [{ label: "Acceptance Dropdown", value: "Option A" }],
  };
  const text = formatReservationConfirmationSummary(summary);
  for (const [left, right] of [
    ["Booking summary", "Service: Acceptance Test Service"],
    ["Service: Acceptance Test Service", "Provider: Acceptance Test Team Member"],
    ["Provider: Acceptance Test Team Member", "Date: 2026-09-24"],
    ["Date: 2026-09-24", "Time: 09:00"],
    ["Time: 09:00", "Customer: Tim Harmsen"],
    ["Customer: Tim Harmsen", "Email: tim@test.com"],
    ["Email: tim@test.com", "Phone: 1234567"],
    ["Phone: 1234567", "Additional details:"],
    ["Additional details:", "Acceptance Dropdown: Option A"],
    ["Acceptance Dropdown: Option A", "Reply **yes** to confirm or **no** to cancel."],
  ]) assert.match(text, new RegExp(`${escapeRegExp(left)}\\n\\n${escapeRegExp(right)}`));
  assert.doesNotMatch(text, /Customer: Tim Harmsen[\s\S]*Name:/);

  const success = formatReservationSuccessResponse(summary, { reference: "BK-ABC123" });
  assert.match(success, /Your appointment is confirmed\.\n\nService: Acceptance Test Service/);
  assert.match(success, /Service: Acceptance Test Service\n\nProvider: Acceptance Test Team Member/);
  assert.match(success, /Reference: BK-ABC123/);
});

test("confirmation email claims only after completion and does not resend on replay", async () => {
  const calls = [];
  const doc = { _id: "attempt", notification: { email: { status: "not_attempted", attempts: 0 } } };
  const model = {
    async findOneAndUpdate(query, update) {
      if (update.$set?.["notification.email.status"] === "sending") {
        if (doc.notification.email.status !== "not_attempted") return null;
        Object.assign(doc.notification.email, { ...doc.notification.email, status: "sending", claimToken: update.$set["notification.email.claimToken"] });
        return doc;
      }
      if (query["notification.email.claimToken"] === doc.notification.email.claimToken) {
        Object.assign(doc.notification.email, update.$set["notification.email.status"] === "sent"
          ? { status: "sent", claimToken: null }
          : { status: "failed", claimToken: null });
        return doc;
      }
      return null;
    },
  };
  const args = {
    context: { companyId: "company", chatbotId: "chatbot", sessionId: "session" },
    bookingAttemptId: "attempt-1",
    summary: { serviceName: "Massage", providerName: "Dr A", localDate: "2026-09-24", localTime: "09:00", customer: { name: "Aisha", email: "aisha@example.com" } },
    result: { reference: "BK-123" },
    model,
    send: async (payload) => { calls.push(payload); return { id: "mail-1" }; },
  };
  assert.equal((await sendAiReservationConfirmationEmail(args)).status, "sent");
  assert.equal((await sendAiReservationConfirmationEmail(args)).reason, "already_claimed");
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /Reference: BK-123/);
});

test("confirmation email uses only the authoritative booking reference", async () => {
  let emailPayload;
  const model = makeAtomicAttemptModel({
    _id: "attempt",
    companyId: "company",
    chatbotId: "chatbot",
    sessionId: "session",
    bookingAttemptId: "attempt-1",
    status: "completed",
    notification: { email: { status: "not_attempted", attempts: 0 } },
  });
  const result = await sendAiReservationConfirmationEmail({
    context: { companyId: "company", chatbotId: "chatbot", sessionId: "session" },
    bookingAttemptId: "attempt-1",
    summary: { serviceName: "Massage", customer: { email: "aisha@example.com" } },
    result: { reference: "BK-ABC123", bookingId: "generated-or-internal-id" },
    model,
    send: async (payload) => { emailPayload = payload; return { id: "mail-1" }; },
  });
  assert.equal(result.status, "sent");
  assert.match(emailPayload.text, /Reference: BK-ABC123/);
  assert.doesNotMatch(emailPayload.text, /generated-or-internal-id/);
});

test("booking write resolves before email claim and email failure cannot retry the booking", async () => {
  const restoreEmail = withoutEmailConfiguration();
  const events = [];
  const model = makeAtomicAttemptModel({
    _id: "attempt",
    companyId: "company-1",
    chatbotId: "chatbot-1",
    sessionId: "session-1",
    bookingAttemptId: "attempt-1",
    idempotencyKey: bookingFlow.idempotencyKey,
    requestFingerprint: bookingFingerprint,
    status: "draft",
    notification: { email: { status: "not_attempted", attempts: 0 } },
  }, (_query, update) => {
    if (update.$set?.["notification.email.status"] === "sending") events.push("email_claim");
  });
  let writes = 0;
  try {
    const result = await executeAiReservationBooking({
      context: bookingContext,
      session: { reservationFlow: bookingFlow },
      model,
      contextResolver: async () => bookingContext,
      readAdapter: makeBookingReadAdapter(),
      writeAdapter: { async createAppointment() { events.push("write_started"); writes += 1; const value = { bookingId: "booking-1", reference: "BK-ABC123" }; events.push("write_resolved"); return value; } },
    });
    assert.equal(result.bookingCreated, true);
    assert.equal(result.result.reference, "BK-ABC123");
    assert.equal(result.confirmationEmail.status, "failed");
    assert.equal(model.rows[0].status, "completed");
    assert.equal(writes, 1);
    assert.equal(events.indexOf("write_resolved") < events.indexOf("email_claim"), true);
  } finally {
    restoreEmail();
  }
  assert.equal(events.includes("email_claim"), true);
});

test("failed booking write does not attempt email notification", async () => {
  const restoreEmail = withoutEmailConfiguration();
  const model = makeAtomicAttemptModel({
    _id: "attempt",
    companyId: "company-1",
    chatbotId: "chatbot-1",
    sessionId: "session-1",
    bookingAttemptId: "attempt-1",
    idempotencyKey: bookingFlow.idempotencyKey,
    requestFingerprint: bookingFingerprint,
    status: "draft",
    notification: { email: { status: "not_attempted", attempts: 0 } },
  });
  let writes = 0;
  try {
    await assert.rejects(executeAiReservationBooking({
      context: bookingContext,
      session: { reservationFlow: bookingFlow },
      model,
      contextResolver: async () => bookingContext,
      readAdapter: makeBookingReadAdapter(),
      writeAdapter: { async createAppointment() { writes += 1; throw new Error("provider rejected booking"); } },
    }));
  } finally {
    restoreEmail();
  }
  assert.equal(writes, 1);
  assert.equal(model.rows[0].notification.email.status, "not_attempted");
});

test("concurrent completed-attempt email claims allow one automatic send", async () => {
  let sends = 0;
  const model = makeAtomicAttemptModel({
    _id: "attempt",
    companyId: "company",
    chatbotId: "chatbot",
    sessionId: "session",
    bookingAttemptId: "attempt-1",
    status: "completed",
    notification: { email: { status: "not_attempted", attempts: 0 } },
  });
  const args = {
    context: { companyId: "company", chatbotId: "chatbot", sessionId: "session" },
    bookingAttemptId: "attempt-1",
    summary: { serviceName: "Massage", customer: { email: "aisha@example.com" } },
    result: { reference: "BK-ABC123" },
    model,
    send: async () => { sends += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { id: "mail-1" }; },
  };
  const results = await Promise.all([sendAiReservationConfirmationEmail(args), sendAiReservationConfirmationEmail(args)]);
  assert.equal(results.filter(({ status }) => status === "sent").length, 1);
  assert.equal(results.filter(({ reason }) => reason === "already_claimed").length, 1);
  assert.equal(sends, 1);
  assert.equal(model.rows[0].notification.email.status, "sent");
  assert.equal(model.rows[0].status, "completed");
});
