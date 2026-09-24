import test from "node:test";
import assert from "node:assert/strict";
import { handleAiReservationConversation, isClassInformationIntent, isReservationDomainIntent } from "../services/aiReservationConversationService.js";
import { formatReservationConfirmationSummary } from "../services/aiReservationFlowService.js";
import { createReservationReadAdapter } from "../services/reservationReadAdapter.js";
import { fingerprintScheduledSessionBookingRequest } from "../utils/reservationRequestFingerprint.js";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const context = {
  companyId: "company-learning-centre",
  installationId: "installation-learning-centre",
  chatbotId: "chatbot-learning-centre",
  sessionId: "session-learning-centre",
  reservationBusinessId: 42,
  reservationBusinessSlug: "learning-centre-test",
  configuration: {
    templateKey: "learning_centre",
    capabilities: { services: true, teamResources: true, scheduledSessions: true, packages: true, guestCount: false },
    terminology: { serviceSingular: "Class", servicePlural: "Classes", customerSingular: "Student", teamMemberSingular: "Teacher" },
    bookingBehavior: { booking_behavior: "immediate" },
  },
};

const services = [
  { id: "class-1", slug: "maths-foundations", name: "Maths Foundations", schedulingMode: "scheduled", enrollmentMode: "individual", bookingType: "class" },
  { id: "cohort-class-1", slug: "cohort-class", name: "Cohort Class", schedulingMode: "scheduled", enrollmentMode: "cohort", bookingType: "class" },
  { id: "cohort-only-1", slug: "cohort-course", name: "Cohort Course", schedulingMode: "scheduled", enrollmentMode: "cohort", bookingType: "cohort" },
  { id: "appointment-1", slug: "private-tutoring", name: "Private Tutoring", schedulingMode: "appointment", enrollmentMode: "individual", bookingType: "appointment" },
];

const sessions = [
  { id: "session-early", serviceId: "class-1", startsAt: "2026-10-02T09:00:00+08:00", endsAt: "2026-10-02T10:00:00+08:00", timezone: "Asia/Singapore", staffName: "Teacher Early", remainingCapacity: 5 },
  { id: "session-late", serviceId: "class-1", startsAt: "2026-10-09T09:00:00+08:00", endsAt: "2026-10-09T10:00:00+08:00", timezone: "Asia/Singapore", staffName: "Teacher Late", remainingCapacity: 4 },
  { id: "session-same-day", serviceId: "class-1", startsAt: "2026-10-02T11:00:00+08:00", endsAt: "2026-10-02T12:00:00+08:00", timezone: "Asia/Singapore", staffName: "Teacher Same Day", remainingCapacity: 3 },
  { id: "session-cohort-class", serviceId: "cohort-class-1", startsAt: "2026-10-03T09:00:00+08:00", endsAt: "2026-10-03T10:00:00+08:00", timezone: "Asia/Manila", staffName: "Teacher Cohort Class", remainingCapacity: 5 },
];

const form = [
  { id: "full-name", label: "Full name", type: "text", required: true, systemKey: "name" },
  { id: "phone", label: "Phone", type: "phone", required: true, systemKey: "phone" },
  { id: "email", label: "Email", type: "email", required: true, systemKey: "email" },
  { id: "student-name", label: "Student name", type: "text", required: true, systemKey: "student_name" },
  { id: "age", label: "Age / year level", type: "text", required: false, systemKey: "age_year_level" },
  { id: "subject", label: "Subject or programme", type: "text", required: true, systemKey: "subject_or_programme" },
  { id: "first-visit", label: "First visit?", type: "dropdown", options: ["Yes", "No"], required: false, systemKey: "first_visit" },
];

const makeReadAdapter = (calls = [], serviceRows = services, sessionRows = sessions) => ({
  listBookableServices: async () => { calls.push("services"); return serviceRows; },
  listScheduledSessions: async (_context, args) => {
    calls.push(["sessions", args]);
    const serviceId = args?.serviceSlug === "cohort-class" ? "cohort-class-1" : "class-1";
    return sessionRows.filter((item) => item.serviceId === serviceId);
  },
  getCustomerForm: async () => { calls.push("customer-form"); return form; },
});

const makeSession = () => ({ reservationFlow: null });

test("Learning Centre booking intent is transactional while class availability remains informational", () => {
  assert.equal(isClassInformationIntent("What classes are available?"), true);
  assert.equal(isClassInformationIntent("I want to book a class"), false);
  assert.equal(isReservationDomainIntent("Enroll my child in English"), true);
  assert.equal(isReservationDomainIntent("Book a meeting about the class"), false);
  assert.equal(isReservationDomainIntent("Schedule a callback about our training programme"), false);
  assert.equal(isReservationDomainIntent("I want to register for a class"), true);
});

test("scheduled start accepts cohort-enrollment classes but excludes cohort-only and appointment services", async () => {
  const calls = [];
  const session = makeSession();
  const result = await handleAiReservationConversation({ context, session, message: "I want to book a class", readAdapter: makeReadAdapter(calls) });
  assert.match(result.reply, /Maths Foundations/);
  assert.match(result.reply, /Cohort Class/);
  assert.doesNotMatch(result.reply, /Cohort Course|Private Tutoring/);
  assert.equal(session.reservationFlow.journeyType, "scheduled_session");
  assert.equal(session.reservationFlow.quantity, 1);
});

test("scheduled-session eligibility follows class/course type, not enrollment mode", async () => {
  const session = makeSession();
  const result = await handleAiReservationConversation({ context, session, message: "I want to book a class", readAdapter: makeReadAdapter() });
  assert.match(result.reply, /Cohort Class/);
  assert.doesNotMatch(result.reply, /Cohort Course/);
});

test("cohort-enrollment class offers its authoritative scheduled session", async () => {
  const session = makeSession();
  const adapter = makeReadAdapter();
  await handleAiReservationConversation({ context, session, message: "I want to book a class", readAdapter: adapter });
  const result = await handleAiReservationConversation({ context, session, message: "Cohort Class", readAdapter: adapter });
  assert.match(result.reply, /Teacher Cohort Class/);
  assert.equal(session.reservationFlow.status, "slot_selection");
  assert.equal(session.reservationFlow.selectionOptions[0].id, "session-cohort-class");
});

test("non-scheduled class is not offered as a scheduled-session journey", async () => {
  const calls = [];
  const session = makeSession();
  const generatedClass = { id: "generated-class", slug: "generated-class", name: "Generated Class", schedulingMode: "generated", enrollmentMode: "cohort", bookingType: "class" };
  const writeAdapter = new Proxy({}, { get: () => { throw new Error("non-scheduled class must not reach a write"); } });
  const result = await handleAiReservationConversation({ context, session, message: "I want to book a class", readAdapter: makeReadAdapter(calls, [generatedClass], []), writeAdapter });
  assert.match(result.reply, /No bookable classes or scheduled sessions are currently available/i);
  assert.equal(session.reservationFlow, undefined);
  assert.equal(calls.includes("sessions"), false);
});

test("eligible class with no authoritative sessions returns no availability without starting a form", async () => {
  const calls = [];
  const session = makeSession();
  const cohortClass = services.find((service) => service.id === "cohort-class-1");
  const writeAdapter = new Proxy({}, { get: () => { throw new Error("empty scheduled sessions must not reach a write"); } });
  const adapter = makeReadAdapter(calls, [cohortClass], []);
  await handleAiReservationConversation({ context, session, message: "I want to book a class", readAdapter: adapter, writeAdapter });
  const result = await handleAiReservationConversation({ context, session, message: "Cohort Class", readAdapter: adapter, writeAdapter });
  assert.match(result.reply, /No upcoming sessions are currently available for that class/i);
  assert.equal(session.reservationFlow.status, "service_selection");
  assert.equal(session.reservationFlow.selectionOptions.length, 0);
  assert.doesNotMatch(result.reply, /full name|student name|registration summary/i);
  assert.equal(calls.filter((call) => Array.isArray(call) && call[0] === "sessions").length, 1);
});

test("scheduled service selection reads authoritative sessions and preserves session identity", async () => {
  const session = makeSession();
  const adapter = makeReadAdapter();
  await handleAiReservationConversation({ context, session, message: "book a class", readAdapter: adapter });
  const result = await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter });
  assert.match(result.reply, /1\./);
  assert.match(result.reply, /2\./);
  assert.equal(session.reservationFlow.status, "slot_selection");
  assert.deepEqual(session.reservationFlow.selectionOptions.map((item) => item.id), ["session-early", "session-same-day", "session-late"]);
});

test("two-turn scheduled selection uses the real adapter date window after session round-trip", async () => {
  const originalFetch = globalThis.fetch;
  const rpcCalls = [];
  let writeCalls = 0;
  const productionContext = { ...context, reservationBusinessId: 10, reservationBusinessSlug: "terrapeak" };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/rest/v1/services?")) {
      return new Response(JSON.stringify([{
        id: 56,
        business_id: 10,
        slug: "test-math-class",
        name: "test Math Class",
        booking_type: "class",
        scheduling_mode: "scheduled",
        enrollment_mode: "cohort",
        is_active: true,
        is_published: true,
        is_internal: false,
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/rest/v1/rpc/get_public_scheduled_sessions")) {
      rpcCalls.push(JSON.parse(init.body));
      return new Response(JSON.stringify([{
        session_id: 300,
        service_id: 56,
        starts_at: "2026-09-30T05:00:00Z",
        ends_at: "2026-09-30T06:00:00Z",
        staff_slug: "test-math-jane-lin",
        staff_name: "Test math Jane Lin",
        staff_timezone: "Asia/Manila",
        capacity: 5,
        remaining_capacity: 5,
        notes: null,
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected transport request: ${url}`);
  };

  try {
    const readAdapter = createReservationReadAdapter(undefined, { now: () => new Date("2026-09-24T12:00:00Z") });
    const writeAdapter = new Proxy({}, { get: () => { writeCalls += 1; throw new Error("scheduled-session write must not be called"); } });
    const firstSession = makeSession();
    const first = await handleAiReservationConversation({
      context: productionContext,
      session: firstSession,
      message: "I want to book a class",
      readAdapter,
      writeAdapter,
    });
    assert.match(first.reply, /test Math Class/);
    assert.equal(firstSession.reservationFlow.journeyType, "scheduled_session");
    assert.equal(firstSession.reservationFlow.selectionOptions[0].slug, "test-math-class");

    const restoredSession = JSON.parse(JSON.stringify(firstSession));
    const second = await handleAiReservationConversation({
      context: productionContext,
      session: restoredSession,
      message: "1",
      readAdapter,
      writeAdapter,
    });
    assert.equal(restoredSession.reservationFlow.serviceSlug, "test-math-class");
    assert.equal(restoredSession.reservationFlow.status, "slot_selection");
    assert.equal(restoredSession.reservationFlow.selectionOptions[0].id, 300);
    assert.match(second.reply, /30 September 2026/);
    assert.deepEqual(rpcCalls, [{
      p_business_slug: "terrapeak",
      p_service_slug: "test-math-class",
      p_from_date: "2026-09-24",
      p_to_date: "2026-11-23",
    }]);
    assert.equal(writeCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("next class selects the first chronological authoritative session", async () => {
  const session = makeSession();
  const adapter = makeReadAdapter();
  await handleAiReservationConversation({ context, session, message: "book a class", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter });
  const result = await handleAiReservationConversation({ context, session, message: "next class", readAdapter: adapter });
  assert.match(result.reply, /full name/i);
  assert.equal(session.reservationFlow.scheduledSessionId, "session-early");
  assert.equal(session.reservationFlow.providerName, "Teacher Early");
  assert.equal(session.reservationFlow.quantity, 1);
});

test("numbered scheduled-session selection uses canonical option and does not invent a slot", async () => {
  const session = makeSession();
  const adapter = makeReadAdapter();
  await handleAiReservationConversation({ context, session, message: "book a class", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter });
  const result = await handleAiReservationConversation({ context, session, message: "2", readAdapter: adapter });
  assert.match(result.reply, /full name/i);
  assert.equal(session.reservationFlow.scheduledSessionId, "session-same-day");
  assert.equal(session.reservationFlow.startsAt, sessions[2].startsAt);
  assert.equal(session.reservationFlow.status, "customer_form");
});

test("ambiguous direct date remains in session selection", async () => {
  const session = makeSession();
  const adapter = makeReadAdapter();
  await handleAiReservationConversation({ context, session, message: "book a class", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter });
  const result = await handleAiReservationConversation({ context, session, message: "2026-10-02", readAdapter: adapter });
  assert.equal(session.reservationFlow.status, "slot_selection");
  assert.match(result.reply, /choose a numbered option|more than one|couldn't match/i);
});

test("unique direct date and time matches only the authoritative session", async () => {
  const session = makeSession();
  const adapter = makeReadAdapter();
  await handleAiReservationConversation({ context, session, message: "book a class", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter });
  const result = await handleAiReservationConversation({ context, session, message: "2026-10-09 at 09:00", readAdapter: adapter });
  assert.match(result.reply, /full name/i);
  assert.equal(session.reservationFlow.scheduledSessionId, "session-late");
});

test("invalid scheduled-session indexes do not invent a class", async () => {
  const session = makeSession();
  const adapter = makeReadAdapter();
  await handleAiReservationConversation({ context, session, message: "book a class", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter });
  const result = await handleAiReservationConversation({ context, session, message: "0", readAdapter: adapter });
  assert.equal(session.reservationFlow.status, "slot_selection");
  assert.match(result.reply, /couldn't match|choose a session/i);
});

test("Customer Form preserves guardian contact semantics and continues required class fields", async () => {
  const session = makeSession();
  const adapter = makeReadAdapter();
  await handleAiReservationConversation({ context, session, message: "book a class", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "Guardian Name", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "guardian@example.com", readAdapter: adapter });
  const next = await handleAiReservationConversation({ context, session, message: "0123456789", readAdapter: adapter });
  assert.match(next.reply, /student name/i);
  assert.equal(session.reservationFlow.customer.name, "Guardian Name");
  assert.equal(session.reservationFlow.customer.email, "guardian@example.com");
  assert.equal(session.reservationFlow.customer.phone, "0123456789");
});

test("required Student and Subject fields reject skip while optional fields allow it", async () => {
  const session = makeSession();
  const adapter = makeReadAdapter();
  await handleAiReservationConversation({ context, session, message: "book a class", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "Guardian Name", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "guardian@example.com", readAdapter: adapter });
  await handleAiReservationConversation({ context, session, message: "0123456789", readAdapter: adapter });
  const studentSkip = await handleAiReservationConversation({ context, session, message: "skip", readAdapter: adapter });
  assert.match(studentSkip.reply, /required.*student name/i);
  await handleAiReservationConversation({ context, session, message: "Student Name", readAdapter: adapter });
  const ageSkip = await handleAiReservationConversation({ context, session, message: "skip", readAdapter: adapter });
  assert.match(ageSkip.reply, /subject or programme/i);
  const subjectSkip = await handleAiReservationConversation({ context, session, message: "skip", readAdapter: adapter });
  assert.match(subjectSkip.reply, /required.*subject or programme/i);
});

test("scheduled summary uses Learning Centre terminology and explicit confirmation boundary", () => {
  const summary = formatReservationConfirmationSummary({
    journeyType: "scheduled_session",
    serviceName: "Maths Foundations",
    localDate: "2026-10-02",
    localTime: "09:00",
    timezone: "Asia/Singapore",
    teacherName: "Teacher Early",
    customer: { name: "Guardian Name", email: "guardian@example.com", phone: "0123456789" },
    customFields: [
      { label: "Student name", fieldKey: "student_name", value: "Student Name" },
      { label: "Subject or programme", fieldKey: "subject_or_programme", value: "Mathematics" },
    ],
  });
  assert.match(summary, /Learning Centre registration summary/);
  assert.match(summary, /Class: Maths Foundations/);
  assert.match(summary, /Teacher: Teacher Early/);
  assert.match(summary, /Student: Student Name/);
  assert.doesNotMatch(summary, /appointment|restaurant|booking reference/i);
  assert.match(summary, /Reply \*\*yes\*\* to confirm or \*\*no\*\* to cancel/);
});

test("yes is deterministic and performs no booking or class-enrollment writes", async () => {
  const session = makeSession();
  const calls = [];
  const adapter = makeReadAdapter(calls);
  const writeAdapter = new Proxy({}, { get: () => { throw new Error("scheduled-session write must not be called"); } });
  await handleAiReservationConversation({ context, session, message: "book a class", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "Guardian Name", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "guardian@example.com", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "0123456789", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "Student Name", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "skip", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "Mathematics", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "skip", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "yes", readAdapter: adapter, writeAdapter });
  assert.equal(session.reservationFlow.status, "ready_to_commit");
  assert.equal(session.reservationFlow.bookingAttemptId, null);
  assert.equal(calls.filter((call) => Array.isArray(call) && call[0] === "sessions").length, 1);
});

test("no cancels the scheduled journey without an attempt, reference, or write", async () => {
  const session = makeSession();
  const adapter = makeReadAdapter();
  const writeAdapter = new Proxy({}, { get: () => { throw new Error("scheduled-session write must not be called"); } });
  await handleAiReservationConversation({ context, session, message: "book a class", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "1", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "Guardian Name", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "guardian@example.com", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "0123456789", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "Student Name", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "skip", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "Mathematics", readAdapter: adapter, writeAdapter });
  await handleAiReservationConversation({ context, session, message: "skip", readAdapter: adapter, writeAdapter });
  assert.equal(session.reservationFlow.status, "awaiting_confirmation");
  const result = await handleAiReservationConversation({ context, session, message: "no", readAdapter: adapter, writeAdapter });
  assert.match(result.reply, /cancelled/i);
  assert.equal(session.reservationFlow.status, "cancelled");
  assert.equal(session.reservationFlow.scheduledSessionId, null);
  assert.equal(session.reservationFlow.bookingAttemptId, null);
  assert.doesNotMatch(result.reply, /reference|confirmed|reserved/i);
});

test("scheduled fingerprint includes journey, business, service, session, contact and custom data", () => {
  const first = fingerprintScheduledSessionBookingRequest({ companyId: "company-a", reservationBusinessId: 42, reservationBusinessSlug: "learning-centre-test", serviceId: "class-1", serviceSlug: "maths-foundations", scheduledSessionId: "session-early", startsAt: sessions[0].startsAt, quantity: 1, customerName: "Guardian", customerEmail: "GUARDIAN@EXAMPLE.COM", customerPhone: "+65 1234 5678", customData: { subject: "Maths" } });
  const second = fingerprintScheduledSessionBookingRequest({ companyId: "company-a", reservationBusinessId: 42, reservationBusinessSlug: "learning-centre-test", serviceId: "class-1", serviceSlug: "maths-foundations", scheduledSessionId: "session-late", startsAt: sessions[1].startsAt, quantity: 1, customerName: "Guardian", customerEmail: "guardian@example.com", customerPhone: "6512345678", customData: { subject: "Maths" } });
  const otherCompany = fingerprintScheduledSessionBookingRequest({ companyId: "company-b", reservationBusinessId: 42, reservationBusinessSlug: "learning-centre-test", serviceId: "class-1", serviceSlug: "maths-foundations", scheduledSessionId: "session-early", startsAt: sessions[0].startsAt, quantity: 1, customerName: "Guardian", customerEmail: "guardian@example.com", customerPhone: "6512345678", customData: { subject: "Maths" } });
  assert.equal(first.payload.quantity, 1);
  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.notEqual(first.fingerprint, otherCompany.fingerprint);
  assert.equal(first.payload.customerEmail, "guardian@example.com");
  assert.equal(first.payload.customerPhone, "6512345678");
});

test("multi-student request is bounded to one student and packages/cohorts remain informational", async () => {
  const session = makeSession();
  const result = await handleAiReservationConversation({ context, session, message: "book 2 students into a class", readAdapter: makeReadAdapter() });
  assert.match(result.reply, /one student/i);
  assert.equal(session.reservationFlow, null);
});
