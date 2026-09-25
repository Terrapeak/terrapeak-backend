import test from "node:test";
import assert from "node:assert/strict";
import { executeAiReservationBooking } from "../services/aiReservationBookingService.js";
import { confirmReservationFoundation } from "../services/aiReservationFlowService.js";
import { createReservationWriteAdapter } from "../services/reservationWriteAdapter.js";
import { reconcileReservationBookingAttempt } from "../services/reservationBookingReconciliationService.js";
import { buildEmailContent } from "../services/aiReservationConfirmationEmailService.js";
import { sendAiReservationConfirmationEmail } from "../services/aiReservationConfirmationEmailService.js";
import { formatReservationSuccessResponse } from "../services/aiReservationFlowService.js";
import { fingerprintScheduledSessionBookingRequest } from "../utils/reservationRequestFingerprint.js";

const context = {
  companyId: "company-learning",
  chatbotId: "chatbot-learning",
  sessionId: "session-learning",
  reservationBusinessId: 42,
  reservationBusinessSlug: "learning-centre-test",
  configuration: {
    templateKey: "learning_centre",
    capabilities: { services: true, scheduledSessions: true },
  },
};

const service = { id: "class-1", slug: "maths-foundations", name: "Maths Foundations", bookingType: "class", schedulingMode: "scheduled" };
const scheduledSession = { id: "session-1", serviceId: "class-1", startsAt: "2099-10-02T09:00:00+08:00", endsAt: "2099-10-02T10:00:00+08:00", timezone: "Asia/Singapore", staffName: "Teacher A", remainingCapacity: 3 };
const form = [
  { id: "full-name", label: "Full name", type: "text", required: true, systemKey: "name" },
  { id: "email", label: "Email", type: "email", required: true, systemKey: "email" },
  { id: "phone", label: "Phone", type: "phone", required: true, systemKey: "phone" },
  { id: "student", label: "Student name", type: "text", required: true, systemKey: "student_name" },
  { id: "subject", label: "Subject", type: "text", required: true },
];

const makeReadAdapter = (overrides = {}) => ({
  listBookableServices: async () => [service],
  listScheduledSessions: async () => [scheduledSession],
  getCustomerForm: async () => form,
  ...overrides,
});

const makeModel = (initial = null) => {
  let stored = initial;
  return {
    async findOne(query) { return stored && (!query.bookingAttemptId || stored.bookingAttemptId === query.bookingAttemptId) && (!query.idempotencyKey || stored.idempotencyKey === query.idempotencyKey) ? { ...stored } : null; },
    async create(value) { stored = { ...value }; return { ...stored }; },
    async findOneAndUpdate(query, update) {
      if (!stored) return null;
      if (query.bookingAttemptId && stored.bookingAttemptId !== query.bookingAttemptId) return null;
      if (query.idempotencyKey && stored.idempotencyKey !== query.idempotencyKey) return null;
      if (query.status && typeof query.status === "string" && stored.status !== query.status) return null;
      if (query.status?.$in && !query.status.$in.includes(stored.status)) return null;
      if (update.$set) stored = { ...stored, ...update.$set };
      return { ...stored };
    },
    get value() { return stored; },
  };
};

const makeFlow = (overrides = {}) => {
  const customData = { student: "Student A", subject: "Mathematics" };
  const request = {
    companyId: context.companyId,
    reservationBusinessId: context.reservationBusinessId,
    reservationBusinessSlug: context.reservationBusinessSlug,
    serviceId: service.id,
    serviceSlug: service.slug,
    scheduledSessionId: scheduledSession.id,
    startsAt: scheduledSession.startsAt,
    endsAt: scheduledSession.endsAt,
    localDate: "2099-10-02",
    localTime: "09:00",
    timezone: "Asia/Singapore",
    quantity: 1,
    startsAt: scheduledSession.startsAt,
    customerName: "Guardian A",
    customerEmail: "guardian@example.com",
    customerPhone: "0123456789",
    customData: { student: "Student A", subject: "Mathematics", _field_labels: { student: "Student name", subject: "Subject" } },
  };
  const { fingerprint } = fingerprintScheduledSessionBookingRequest(request);
  return {
    status: "awaiting_confirmation",
    journeyType: "scheduled_session",
    companyId: context.companyId,
    businessId: String(context.reservationBusinessId),
    serviceId: service.id,
    serviceSlug: service.slug,
    scheduledSessionId: scheduledSession.id,
    quantity: 1,
    customer: { name: "Guardian A", email: "guardian@example.com", phone: "0123456789" },
    customData,
    confirmation: { fingerprint, summary: { journeyType: "scheduled_session", customer: {} } },
    ...overrides,
  };
};

test("scheduled-session gate disabled performs no write", async () => {
  const session = { reservationFlow: makeFlow() };
  let writes = 0;
  const result = await confirmReservationFoundation({ context, session, message: "yes", env: { AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED: "false" }, writeAdapter: { createScheduledSessionBooking: async () => { writes += 1; } } });
  assert.equal(result.bookingCreated, false);
  assert.equal(writes, 0);
  assert.equal(session.reservationFlow.status, "ready_to_commit");
});

test("valid scheduled-session YES calls the exact idempotent adapter contract once", async () => {
  const model = makeModel();
  const calls = [];
  const writeAdapter = { async createScheduledSessionBooking(payload) { calls.push(payload); return { bookingId: "booking-1", reference: "BK-1" }; } };
  const session = { reservationFlow: makeFlow() };
  const result = await executeAiReservationBooking({ context, session, model, readAdapter: makeReadAdapter(), writeAdapter });
  assert.equal(result.bookingCreated, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    reservationBusinessSlug: "learning-centre-test",
    serviceSlug: "maths-foundations",
    sessionId: "session-1",
    customerName: "Guardian A",
    customerEmail: "guardian@example.com",
    customerPhone: "0123456789",
    notes: undefined,
    quantity: 1,
    customData: { student: "Student A", subject: "Mathematics", _field_labels: { student: "Student name", subject: "Subject" } },
    idempotencyKey: "company-learning:" + session.reservationFlow.bookingAttemptId,
    requestFingerprint: session.reservationFlow.confirmation.fingerprint,
  });
  assert.equal(model.value.status, "completed");
  assert.equal(session.reservationFlow.scheduledSessionId, "session-1");
});

test("duplicate scheduled-session confirmation returns the same attempt result without a second write", async () => {
  const model = makeModel();
  let writes = 0;
  const session = { reservationFlow: makeFlow() };
  const writeAdapter = { async createScheduledSessionBooking() { writes += 1; return { bookingId: "booking-1", reference: "BK-1" }; } };
  const first = await executeAiReservationBooking({ context, session, model, readAdapter: makeReadAdapter(), writeAdapter });
  const second = await executeAiReservationBooking({ context, session, flow: session.reservationFlow, model, readAdapter: makeReadAdapter(), writeAdapter });
  assert.equal(first.result.reference, "BK-1");
  assert.equal(second.result.reference, "BK-1");
  assert.equal(second.replayed, true);
  assert.equal(writes, 1);
});

test("scheduled-session quantity other than one fails before write", async () => {
  const session = { reservationFlow: makeFlow({ quantity: 2 }) };
  let writes = 0;
  await assert.rejects(executeAiReservationBooking({ context, session, model: makeModel(), readAdapter: makeReadAdapter(), writeAdapter: { async createScheduledSessionBooking() { writes += 1; } } }), { code: "RESERVATION_QUANTITY_INVALID" });
  assert.equal(writes, 0);
});

test("capacity loss is revalidated before the write", async () => {
  const session = { reservationFlow: makeFlow() };
  let writes = 0;
  await assert.rejects(executeAiReservationBooking({ context, session, model: makeModel(), readAdapter: makeReadAdapter({ listScheduledSessions: async () => [{ ...scheduledSession, remainingCapacity: 0 }] }), writeAdapter: { async createScheduledSessionBooking() { writes += 1; } } }), { code: "RESERVATION_SESSION_UNAVAILABLE" });
  assert.equal(writes, 0);
});

test("fingerprint conflict fails closed before claiming or writing", async () => {
  const session = { reservationFlow: makeFlow({ confirmation: { fingerprint: "different" } }) };
  let writes = 0;
  await assert.rejects(executeAiReservationBooking({ context, session, model: makeModel(), readAdapter: makeReadAdapter(), writeAdapter: { async createScheduledSessionBooking() { writes += 1; } } }), { code: "BOOKING_ATTEMPT_CONFLICT" });
  assert.equal(writes, 0);
});

test("reconciliation rejects a recovered booking for another scheduled session", async () => {
  const model = makeModel({ bookingAttemptId: "attempt-1", companyId: context.companyId, chatbotId: context.chatbotId, sessionId: context.sessionId, reservationBusinessId: 42, idempotencyKey: "company-learning:attempt-1", requestFingerprint: "fp", status: "unknown" });
  const result = await reconcileReservationBookingAttempt({
    attempt: model.value,
    context,
    model,
    forceLookup: true,
    writeAdapter: { async findByIdempotencyKey() { return { bookingId: "b", reference: "BK", businessId: 42, idempotencyKey: "company-learning:attempt-1", requestFingerprint: "fp", serviceId: "class-1", scheduledSessionId: "other" }; } },
    expectedIdentity: { businessId: 42, idempotencyKey: "company-learning:attempt-1", serviceId: "class-1", scheduledSessionId: "session-1" },
  });
  assert.equal(result.status, "conflict");
  assert.equal(result.errorCode, "IDEMPOTENCY_REQUEST_CONFLICT");
});

test("write adapter calls only create_public_session_booking_idempotent with quantity one", async () => {
  const rpcCalls = [];
  const adapter = createReservationWriteAdapter({ clientFactory: () => ({ rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: [{ booking_id: "b", reference: "BK" }], error: null }; } }) });
  const result = await adapter.createScheduledSessionBooking({ reservationBusinessSlug: "learning-centre-test", serviceSlug: "maths-foundations", sessionId: "session-1", customerName: "Guardian A", customerEmail: "guardian@example.com", customerPhone: "0123456789", quantity: 1, customData: { student: "Student A" }, idempotencyKey: "key-1", requestFingerprint: "fp-1" });
  assert.equal(result.reference, "BK");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "create_public_session_booking_idempotent");
  assert.equal(rpcCalls[0].args.p_session_id, "session-1");
  assert.equal(rpcCalls[0].args.p_quantity, 1);
  assert.equal(Object.keys(rpcCalls[0].args).sort().join(","), "p_business_slug,p_custom_data,p_customer_email,p_customer_name,p_customer_phone,p_idempotency_key,p_notes,p_quantity,p_request_fingerprint,p_service_slug,p_session_id");
});

test("scheduled success and confirmation email use class-registration terminology", () => {
  const summary = { journeyType: "scheduled_session", serviceName: "Maths Foundations", localDate: "2099-10-02", localTime: "09:00", timezone: "Asia/Singapore", teacherName: "Teacher A", customer: { name: "Guardian A", email: "guardian@example.com" }, customFields: [{ fieldKey: "student_name", label: "Student name", value: "Student A" }] };
  const reply = formatReservationSuccessResponse(summary, { reference: "BK-1" });
  const email = buildEmailContent({ summary, result: { reference: "BK-1" } });
  assert.match(reply, /class registration is confirmed/i);
  assert.match(reply, /Class: Maths Foundations/);
  assert.doesNotMatch(reply, /appointment|restaurant/i);
  assert.match(email.subject, /Class registration confirmed/);
  assert.match(email.text, /Student: Student A/);
});

const assertScheduledFailureBeforeWrite = async ({ flow = makeFlow(), readAdapter = makeReadAdapter(), errorCode }) => {
  const session = { reservationFlow: flow };
  let writes = 0;
  await assert.rejects(
    executeAiReservationBooking({
      context,
      session,
      model: makeModel(),
      readAdapter,
      writeAdapter: {
        async createScheduledSessionBooking() { writes += 1; },
        async create_public_class_enrollment() { throw new Error("class enrollment path must not be called"); },
        async create_public_class_enquiry() { throw new Error("class enquiry path must not be called"); },
      },
    }),
    { code: errorCode },
  );
  assert.equal(writes, 0);
  return session;
};

test("scheduled-session NO cancels before attempt processing, write, or email", async () => {
  const session = { reservationFlow: makeFlow() };
  let writes = 0;
  const result = await confirmReservationFoundation({
    context,
    session,
    message: "no",
    model: { async create() { throw new Error("attempt must not be created"); } },
    writeAdapter: { async createScheduledSessionBooking() { writes += 1; } },
  });
  assert.equal(result.flowStatus, "cancelled");
  assert.equal(session.reservationFlow.status, "cancelled");
  assert.equal(writes, 0);
});

test("scheduled-session gate off returns a truthful no-write result", async () => {
  const session = { reservationFlow: makeFlow() };
  let rpcCalls = 0;
  const result = await confirmReservationFoundation({
    context,
    session,
    message: "yes",
    env: { AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED: "false" },
    model: { async create() { throw new Error("attempt must not be processed"); } },
    writeAdapter: { async createScheduledSessionBooking() { rpcCalls += 1; } },
  });
  assert.equal(result.bookingCreated, false);
  assert.equal(result.scheduledSessionBookingPending, true);
  assert.equal(result.errorCode, "SCHEDULED_SESSION_BOOKING_NOT_ENABLED");
  assert.equal(rpcCalls, 0);
});

test("scheduled-session success preserves canonical occurrence and excludes legacy enrollment paths", async () => {
  const session = { reservationFlow: makeFlow() };
  const calls = [];
  const result = await executeAiReservationBooking({
    context,
    session,
    model: makeModel(),
    readAdapter: makeReadAdapter(),
    writeAdapter: {
      async createScheduledSessionBooking(payload) { calls.push(payload); return { bookingId: "booking-2", reference: "BK-2" }; },
      async create_public_class_enrollment() { throw new Error("class enrollment path must not be called"); },
      async create_public_class_enquiry() { throw new Error("class enquiry path must not be called"); },
    },
  });
  assert.equal(result.result.reference, "BK-2");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, "session-1");
  assert.equal(session.reservationFlow.status, "completed");
});

test("scheduled-session duplicate replay does not send a second email or write", async () => {
  const model = makeModel();
  const session = { reservationFlow: makeFlow() };
  let writes = 0;
  const writeAdapter = { async createScheduledSessionBooking() { writes += 1; return { bookingId: "booking-3", reference: "BK-3" }; } };
  const first = await executeAiReservationBooking({ context, session, model, readAdapter: makeReadAdapter(), writeAdapter });
  const second = await executeAiReservationBooking({ context, session, flow: session.reservationFlow, model, readAdapter: makeReadAdapter(), writeAdapter });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.result.reference, first.result.reference);
  assert.equal(second.confirmationEmail, undefined);
  assert.equal(model.value.status, "completed");
  assert.equal(writes, 1);
});

test("scheduled-session service disabled fails closed before write", async () => {
  await assertScheduledFailureBeforeWrite({
    readAdapter: makeReadAdapter({ listBookableServices: async () => [{ ...service, isActive: false }] }),
    errorCode: "RESERVATION_SERVICE_CHANGED",
  });
});

test("scheduled-session unpublished service fails closed before write", async () => {
  await assertScheduledFailureBeforeWrite({
    readAdapter: makeReadAdapter({ listBookableServices: async () => [{ ...service, isPublished: false }] }),
    errorCode: "RESERVATION_SERVICE_CHANGED",
  });
});

test("cancelled or missing scheduled session fails closed before write", async () => {
  await assertScheduledFailureBeforeWrite({
    readAdapter: makeReadAdapter({ listScheduledSessions: async () => [{ ...scheduledSession, status: "cancelled" }] }),
    errorCode: "RESERVATION_SESSION_UNAVAILABLE",
  });
  await assertScheduledFailureBeforeWrite({
    readAdapter: makeReadAdapter({ listScheduledSessions: async () => [] }),
    errorCode: "RESERVATION_SESSION_UNAVAILABLE",
  });
});

test("newly required Customer Form field fails closed after confirmation", async () => {
  await assertScheduledFailureBeforeWrite({
    readAdapter: makeReadAdapter({ getCustomerForm: async () => [...form, { id: "guardian", label: "Guardian relationship", type: "text", required: true }] }),
    errorCode: "RESERVATION_CUSTOMER_FORM_INVALID",
  });
});

test("optional Customer Form field becoming required fails closed after confirmation", async () => {
  await assertScheduledFailureBeforeWrite({
    readAdapter: makeReadAdapter({ getCustomerForm: async () => [...form, { id: "emergency", label: "Emergency contact", type: "text", required: true }] }),
    errorCode: "RESERVATION_CUSTOMER_FORM_INVALID",
  });
});

test("invalidated Customer Form dropdown answer fails closed before write", async () => {
  await assertScheduledFailureBeforeWrite({
    flow: makeFlow({ customData: { student: "Student A", subject: "Mathematics", level: "Beginner" } }),
    readAdapter: makeReadAdapter({ getCustomerForm: async () => [...form, { id: "level", label: "Level", type: "dropdown", required: false, options: ["Advanced"] }] }),
    errorCode: "RESERVATION_CUSTOMER_FORM_INVALID",
  });
});

test("confirmed fingerprint mismatch fails closed without a reference", async () => {
  const session = await assertScheduledFailureBeforeWrite({ flow: makeFlow({ confirmation: { fingerprint: "stale" } }), errorCode: "BOOKING_ATTEMPT_CONFLICT" });
  assert.equal(session.reservationFlow.status, "awaiting_confirmation");
});

test("ambiguous scheduled write reconciles once through the real adapter and completes", async () => {
  const model = makeModel();
  const session = { reservationFlow: makeFlow() };
  const rpcCalls = [];
  const adapter = createReservationWriteAdapter({
    clientFactory: () => ({ rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === "create_public_session_booking_idempotent") return { data: null, error: { code: "XX000", message: "transport timeout" } };
      return { data: [{ booking_id: "booking-4", reference: "BK-4", starts_at: scheduledSession.startsAt, ends_at: scheduledSession.endsAt, booking_status: "confirmed", business_id: 42, request_fingerprint: session.reservationFlow.confirmation.fingerprint, service_id: "class-1", scheduled_session_id: "session-1", idempotency_key: "company-learning:" + session.reservationFlow.bookingAttemptId }], error: null };
    } }),
  });
  const result = await executeAiReservationBooking({ context, session, model, readAdapter: makeReadAdapter(), writeAdapter: adapter });
  assert.equal(result.recovered, true);
  assert.equal(result.result.reference, "BK-4");
  assert.deepEqual(rpcCalls.map((call) => call.name), ["create_public_session_booking_idempotent", "get_public_booking_by_idempotency_key"]);
  assert.equal(model.value.status, "completed");
});

test("scheduled reconciliation rejects service, session, fingerprint, and idempotency mismatches", async () => {
  const cases = [
    ["serviceId", "other-service"],
    ["scheduledSessionId", "other-session"],
    ["requestFingerprint", "other-fingerprint"],
    ["idempotencyKey", "other-key"],
  ];
  for (const [field, value] of cases) {
    const expected = { businessId: 42, idempotencyKey: "key-5", serviceId: "class-1", scheduledSessionId: "session-1" };
    const recovered = { bookingId: "booking-5", reference: "BK-5", businessId: 42, idempotencyKey: expected.idempotencyKey, requestFingerprint: "fp-5", serviceId: expected.serviceId, scheduledSessionId: expected.scheduledSessionId };
    if (field === "requestFingerprint") recovered.requestFingerprint = value;
    else recovered[field] = value;
    const model = makeModel({ bookingAttemptId: "attempt-5", companyId: context.companyId, chatbotId: context.chatbotId, sessionId: context.sessionId, reservationBusinessId: 42, idempotencyKey: "key-5", requestFingerprint: "fp-5", status: "unknown" });
    const result = await reconcileReservationBookingAttempt({ attempt: model.value, context, model, forceLookup: true, writeAdapter: { async findByIdempotencyKey() { return recovered; } }, expectedIdentity: expected });
    assert.equal(result.status, "conflict");
    assert.notEqual(model.value.status, "completed");
  }
});

test("scheduled adapter maps definite RPC rejections without exposing database details", async () => {
  const cases = [
    ["23P01", "RESERVATION_CAPACITY_UNAVAILABLE"],
    ["P0002", "RESERVATION_SESSION_UNAVAILABLE"],
    ["22023", "RESERVATION_CUSTOMER_FORM_INVALID"],
    ["P0001", "IDEMPOTENCY_REQUEST_CONFLICT"],
  ];
  for (const [code, expectedCode] of cases) {
    const adapter = createReservationWriteAdapter({ clientFactory: () => ({ rpc: async () => ({ data: null, error: { code, message: code === "P0001" ? "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST secret details" : "raw database detail" } }) }) });
    await assert.rejects(adapter.createScheduledSessionBooking({ reservationBusinessSlug: "learning-centre-test", serviceSlug: "maths-foundations", sessionId: "session-1", customerName: "Guardian A", customerEmail: "guardian@example.com", customerPhone: "0123456789", quantity: 1, customData: {}, idempotencyKey: "key-6", requestFingerprint: "fp-6" }), (error) => {
      assert.equal(error.code, expectedCode);
      return true;
    });
  }
});

test("definite scheduled write errors remain safe mapped results", async () => {
  const cases = ["RESERVATION_CAPACITY_UNAVAILABLE", "RESERVATION_SESSION_UNAVAILABLE", "RESERVATION_CUSTOMER_FORM_INVALID", "IDEMPOTENCY_REQUEST_CONFLICT"];
  for (const code of cases) {
    const session = { reservationFlow: makeFlow() };
    const result = await confirmReservationFoundation({
      context,
      session,
      message: "yes",
      env: { AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED: "true" },
      model: makeModel(),
      readAdapter: makeReadAdapter(),
      writeAdapter: { async createScheduledSessionBooking() { throw Object.assign(new Error("raw database detail"), { code }); } },
    });
    assert.equal(result.errorCode, code);
    assert.doesNotMatch(String(result.message || ""), /raw database detail/);
  }
});

test("successful scheduled booking remains completed when confirmation email fails", async () => {
  const model = makeModel();
  const flow = makeFlow();
  flow.confirmation.summary = { journeyType: "scheduled_session", customer: { email: "guardian@example.com" } };
  const session = { reservationFlow: flow };
  let writes = 0;
  const result = await executeAiReservationBooking({ context, session, model, readAdapter: makeReadAdapter(), writeAdapter: { async createScheduledSessionBooking() { writes += 1; return { bookingId: "booking-7", reference: "BK-7" }; } } });
  assert.equal(result.bookingCreated, true);
  assert.equal(result.result.reference, "BK-7");
  assert.equal(result.confirmationEmail.status, "not_attempted");
  assert.equal(model.value.status, "completed");
  assert.equal(writes, 1);
});

test("confirmation email failure is isolated after a completed scheduled booking", async () => {
  let stored = { _id: "attempt-email", notification: { email: { status: "not_attempted" } } };
  const model = {
    async findOneAndUpdate(query, update) {
      if (query.status && query.status !== "completed") return null;
      const set = update.$set || {};
      stored = { ...stored, ...Object.keys(set).reduce((value, key) => {
        const parts = key.split(".");
        let target = value;
        for (const part of parts.slice(0, -1)) target = target[part] ||= {};
        target[parts.at(-1)] = set[key];
        return value;
      }, {}) };
      return { ...stored };
    },
  };
  const result = await sendAiReservationConfirmationEmail({
    context,
    bookingAttemptId: "attempt-email",
    summary: { journeyType: "scheduled_session", customer: { email: "guardian@example.com" } },
    result: { reference: "BK-8" },
    model,
    send: async () => { throw Object.assign(new Error("mail provider unavailable"), { code: "EMAIL_DELIVERY_FAILED" }); },
  });
  assert.equal(result.status, "failed");
  assert.equal(stored.notification.email.status, "failed");
});
