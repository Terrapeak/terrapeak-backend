import assert from "node:assert/strict";
import test from "node:test";
import {
  handleAiReservationConversation,
  isPackageInformationIntent,
  isPackageConfigured,
  isPackagePurchaseIntent,
  isPackageSelectionIntent,
  isReservationDomainIntent,
} from "../services/aiReservationConversationService.js";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
const { resetBookingSession, shouldHandleTypedAppointment } = await import("../controllers/chatbotController.js");

const contextFor = (capabilities = { services: true, teamResources: true, scheduledSessions: false, packages: true }) => ({
  companyId: "company-1",
  chatbotId: "chatbot-1",
  sessionId: "session-1",
  reservationBusinessId: 42,
  reservationBusinessSlug: "tenant-a",
  configuration: {
    templateKey: "physiotherapy",
    capabilities,
    terminology: { servicePlural: "services" },
    bookingBehavior: { booking_behavior: "immediate" },
  },
});

const packageServices = [
  {
    id: 1,
    businessId: 42,
    slug: "physiotherapy-treatment",
    name: "Physiotherapy Treatment",
    subject: "Physiotherapy",
    price: 400,
    currency: "MYR",
    packageSessionCount: 4,
    packageValidityDays: 30,
    isActive: true,
    isPublished: true,
  },
  {
    id: 2,
    businessId: 42,
    slug: "rehabilitation-package",
    name: "Rehabilitation Package",
    price: 800,
    currency: "MYR",
    packageSessionCount: 10,
    packageValidityDays: 60,
    isActive: true,
    isPublished: true,
  },
  { id: 3, businessId: 42, name: "Inactive Package", packageSessionCount: 8, isActive: false, isPublished: true },
  { id: 4, businessId: 42, name: "Unpublished Package", packageSessionCount: 8, isActive: true, isPublished: false },
  { id: 5, businessId: 99, name: "Other Tenant Package", packageSessionCount: 8, isActive: true, isPublished: true },
  { id: 6, businessId: 42, name: "Ordinary Service", price: 50, packageSessionCount: 1, packageValidityDays: null, isActive: true, isPublished: true },
];

const readAdapter = {
  async listBookableServices() { return packageServices; },
};

const noGemini = () => { throw new Error("Gemini must not be called"); };

const learningContext = {
  ...contextFor({ services: true, teamResources: true, scheduledSessions: true, packages: true }),
  configuration: {
    ...contextFor({ services: true, teamResources: true, scheduledSessions: true, packages: true }).configuration,
    templateKey: "learning_centre",
    terminology: { servicePlural: "classes", teamMemberSingular: "teacher" },
  },
};

const ask = (message, { context = contextFor(), session = {}, adapter = readAdapter } = {}) => handleAiReservationConversation({
  context,
  session,
  message,
  readAdapter: adapter,
  model: { generate: noGemini },
});

test("known package phrases are deterministic without broad session matching", () => {
  for (const message of [
    "Do you offer packages?",
    "What packages do you have?",
    "Show me packages",
    "I want a package",
    "I want to buy a package",
    "I want a math package",
    "I want 10 physio sessions",
  ]) assert.equal(isPackageInformationIntent(message), true, message);
  assert.equal(isPackagePurchaseIntent("I want to buy a package"), true);
  assert.equal(isPackageInformationIntent("I want a physio session"), false);
  assert.equal(isPackageInformationIntent("I want 10 sessions"), false);
  assert.equal(isPackageInformationIntent("book a physio appointment"), false);
  assert.equal(isReservationDomainIntent("I want 10 physio sessions"), true);
});

test("explicit package offering overrides legacy metadata while preserving fallback compatibility", () => {
  assert.equal(isPackageConfigured({ offerAsPackage: true, packageSessionCount: 1 }), true);
  assert.equal(isPackageConfigured({ offerAsPackage: false, packageSessionCount: 4, packageValidityDays: 30 }), false);
  assert.equal(isPackageConfigured({ packageSessionCount: 4, packageValidityDays: 30 }), true);
  assert.equal(isPackageConfigured({ packageSessionCount: 1, packageValidityDays: null }), false);
});

test("package list is authoritative, numbered, and renders pricing metadata", async () => {
  const session = {};
  const result = await ask("Show me packages", { session });
  assert.equal(result.handled, true);
  assert.match(result.reply, /Available package options/);
  assert.match(result.reply, /1\. Physiotherapy Treatment/);
  assert.match(result.reply, /MYR 400/);
  assert.match(result.reply, /4 session/);
  assert.match(result.reply, /valid for 30 days/i);
  assert.match(result.reply, /2\. Rehabilitation Package/);
  assert.doesNotMatch(result.reply, /Inactive Package|Unpublished Package|Other Tenant Package|Ordinary Service/);
  assert.equal(session.reservationFlow, undefined);
  assert.equal(session.packageSelection.options.length, 2);
});

test("disabled packages do not expose metadata or read services", async () => {
  const result = await ask("Do you offer packages?", {
    context: contextFor({ services: true, teamResources: true, scheduledSessions: false, packages: false }),
    adapter: { async listBookableServices() { throw new Error("must not read disabled package catalogue"); } },
  });
  assert.match(result.reply, /not enabled/i);
  assert.doesNotMatch(result.reply, /MYR|Physiotherapy/);
});

test("enabled packages with no configured options remain informational", async () => {
  const result = await ask("What packages do you have?", {
    adapter: { async listBookableServices() { return [{ id: 1, name: "Ordinary Service", price: 20 }]; } },
  });
  assert.match(result.reply, /no package options/i);
  assert.equal(result.reservation.flowStatus, "idle");
});

test("business-10 single-session services are not package-configured", async () => {
  const business10Services = [
    { id: 30, businessId: 42, name: "Acceptance Test Service", price: 10000, currency: "MYR", packageSessionCount: 1, packageValidityDays: null, isActive: true, isPublished: true },
    { id: 55, businessId: 42, name: "Appointment", packageSessionCount: 1, packageValidityDays: null, isActive: true, isPublished: true },
    { id: 56, businessId: 42, name: "test Math Class", price: 10000, currency: "PHP", packageSessionCount: 1, packageValidityDays: null, isActive: true, isPublished: true },
  ];
  assert.equal(isPackageConfigured(business10Services[0]), false);
  const result = await ask("Show me packages", {
    adapter: { async listBookableServices() { return business10Services; } },
  });
  assert.match(result.reply, /no package options/i);
  assert.doesNotMatch(result.reply, /Acceptance Test Service|Appointment|test Math Class/);
  assert.equal(result.reservation.flowStatus, "idle");
});

test("genuine multi-session Physio and Learning Centre packages remain eligible", () => {
  assert.equal(isPackageConfigured({ packageSessionCount: 4, packageValidityDays: 30 }), true);
  assert.equal(isPackageConfigured({ packageSessionCount: 4, packageValidityDays: 30, bookingType: "class" }), true);
});

test("explicit package false overrides legacy metadata and capability remains mandatory", async () => {
  assert.equal(isPackageConfigured({ offerAsPackage: false, packageSessionCount: 4, packageValidityDays: 30 }), false);
  const result = await ask("Show me packages", {
    context: contextFor({ services: true, teamResources: true, scheduledSessions: false, packages: false }),
    adapter: { async listBookableServices() { return [{ id: 34, businessId: 42, name: "English Class A", offerAsPackage: true, packageSessionCount: 10, isActive: true, isPublished: true }]; } },
  });
  assert.match(result.reply, /not enabled/i);
});

test("missing optional package values are stated without invention", async () => {
  const result = await ask("Show me packages", {
    adapter: { async listBookableServices() { return [{ id: 7, businessId: 42, name: "Flexible Package", packageSessionCount: 4, isActive: true, isPublished: true }]; } },
  });
  assert.match(result.reply, /Price not provided/);
  assert.match(result.reply, /Validity not provided/);
  assert.doesNotMatch(result.reply, /undefined|null/);
});

test("specific package requests match authoritative service metadata", async () => {
  const math = await ask("I want a math package", {
    adapter: { async listBookableServices() { return [{ ...packageServices[1], name: "Mathematics Class", slug: "mathematics-class" }]; } },
  });
  assert.match(math.reply, /Mathematics Class/);
  assert.match(math.reply, /10 session/);
  assert.equal(math.reservation.flowStatus, "idle");

  const physio = await ask("I want 10 physio sessions", {
    adapter: { async listBookableServices() { return [{ ...packageServices[1], name: "Physiotherapy Treatment", slug: "physiotherapy-treatment" }]; } },
  });
  assert.match(physio.reply, /10 session/);
});

test("unmatched package request does not guess a package or start booking", async () => {
  const result = await ask("I want a swimming package");
  assert.match(result.reply, /could not find a matching/i);
  assert.match(result.reply, /Available package options/);
  assert.equal(result.reservation.flowStatus, "idle");
});

test("numbered package selection only describes the service and never writes", async () => {
  let writes = 0;
  const session = {};
  await ask("Show me packages", { session });
  const result = await handleAiReservationConversation({
    context: contextFor(),
    session,
    message: "1",
    readAdapter,
    writeAdapter: { async createBooking() { writes += 1; } },
    model: { generate: noGemini },
  });
  assert.match(result.reply, /Physiotherapy Treatment/);
  assert.match(result.reply, /request callback/);
  assert.equal(result.reservation.flowStatus, "idle");
  assert.equal(writes, 0);
  assert.equal(session.reservationFlow, undefined);
});

test("package discovery and selection invoke no booking, class, payment, entitlement, or callback writes", async () => {
  const session = {};
  const forbidden = () => { throw new Error("package conversation must not invoke a transactional write"); };
  const adapter = {
    async listBookableServices() { return packageServices.slice(0, 1); },
    createBooking: forbidden,
    createClassEnrollment: forbidden,
    purchasePackage: forbidden,
    createEntitlement: forbidden,
    createPayment: forbidden,
    createCallback: forbidden,
  };
  const listed = await ask("Show me packages", { session, adapter });
  assert.match(listed.reply, /Available package options/);
  assert.equal(session.reservationCallbackStep, undefined);
  const selected = await ask("1", { session, adapter });
  assert.match(selected.reply, /Physiotherapy Treatment/);
  assert.equal(session.reservationFlow, undefined);
  assert.equal(session.reservationCallbackStep, undefined);
});

test("explicit purchase intent offers callback handoff without claiming purchase", async () => {
  const result = await ask("I want to buy package 1");
  assert.match(result.reply, /contact you about purchasing/i);
  assert.match(result.reply, /request callback/);
  assert.doesNotMatch(result.reply, /purchased|payment taken|credits created|reserved/i);
  assert.equal(result.reservation.flowStatus, "idle");
});

test("package questions during an active appointment flow preserve the transactional state", async () => {
  const session = { reservationFlow: { status: "provider_selection", journeyType: "appointment", serviceId: "1" } };
  const result = await ask("What packages do you have?", { session });
  assert.match(result.reply, /Available package options/);
  assert.equal(session.reservationFlow.status, "provider_selection");
  assert.equal(result.reservation.flowStatus, "provider_selection");
});

test("package selection re-reads current price, session count, and validity", async () => {
  let current = { ...packageServices[0] };
  const adapter = { async listBookableServices() { return [current]; } };
  const session = {};
  await ask("Show me packages", { session, adapter });
  current = { ...current, price: 450, packageSessionCount: 6, packageValidityDays: 45 };
  const result = await ask("1", { session, adapter });
  assert.match(result.reply, /MYR 450/);
  assert.match(result.reply, /6 sessions/);
  assert.match(result.reply, /45 days/);
  assert.doesNotMatch(result.reply, /MYR 400|4 sessions|30 days/);
});

test("stale package selection refreshes when service becomes unavailable or loses metadata", async () => {
  let current = [...packageServices.slice(0, 2)];
  const adapter = { async listBookableServices() { return current; } };
  const session = {};
  await ask("Show me packages", { session, adapter });
  current = [{ ...packageServices[1] }];
  let result = await ask("1", { session, adapter });
  assert.match(result.reply, /no longer available/i);
  assert.match(result.reply, /Rehabilitation Package/);
  assert.equal(session.packageSelection.options[0].serviceId, 2);

  current = [{ ...packageServices[1], packageSessionCount: null, packageValidityDays: null }];
  result = await ask("1", { session, adapter });
  assert.match(result.reply, /no longer available|no package options/i);
  assert.equal(session.packageSelection, null);
});

test("invalid package selection is recoverable and performs no writes", async () => {
  let writes = 0;
  const session = {};
  await ask("Show me packages", { session });
  const result = await ask("9", {
    session,
    adapter: { async listBookableServices() { writes += 1; return packageServices.slice(0, 2); } },
  });
  assert.match(result.reply, /couldn't match/i);
  assert.equal(session.packageSelection.options.length, 2);
  assert.equal(session.reservationFlow, undefined);
  assert.equal(writes, 0);
});

test("Learning Centre package selection remains informational and math class booking remains reachable", async () => {
  const session = {};
  const classService = { id: 10, businessId: 42, slug: "math-class", name: "Math Class", bookingType: "class", schedulingMode: "scheduled", packageSessionCount: 10, packageValidityDays: 90, isActive: true, isPublished: true };
  const adapter = {
    async listBookableServices() { return [classService]; },
    async listScheduledSessions() { return [{ id: "session-10", startsAt: "2026-10-01T09:00:00.000Z", timezone: "Asia/Singapore" }]; },
  };
  const listed = await ask("Show me packages", { context: learningContext, session, adapter });
  assert.match(listed.reply, /Math Class/);
  const selected = await ask("1", { context: learningContext, session, adapter });
  assert.match(selected.reply, /10 sessions/);
  assert.equal(session.reservationFlow, undefined);
  assert.equal(isPackageInformationIntent("book a math class"), false);
  const bookingSession = {};
  const booking = await ask("book a math class", { context: learningContext, session: bookingSession, adapter });
  assert.equal(bookingSession.reservationFlow.journeyType, "scheduled_session");
  assert.equal(bookingSession.reservationFlow.status, "service_selection");
  assert.doesNotMatch(booking.reply, /package options/i);
});

test("pending package context gives numeric selection precedence without reset", async () => {
  const session = {};
  await ask("Show me packages", { session });
  assert.equal(isPackageSelectionIntent("1", session), true);
  assert.equal(shouldHandleTypedAppointment({ reservationEnabled: true, message: "1", session }), true);
  const selected = await ask("1", { session });
  assert.match(selected.reply, /Physiotherapy Treatment/);
  assert.equal(session.reservationFlow, undefined);
});

test("explicit booking intent supersedes pending package context", async () => {
  const learningSession = {};
  await ask("Show me packages", { context: learningContext, session: learningSession, adapter: {
    async listBookableServices() { return [{ id: 10, businessId: 42, slug: "math-class", name: "Math Class", bookingType: "class", schedulingMode: "scheduled", packageSessionCount: 10, packageValidityDays: 90, isActive: true, isPublished: true }]; },
    async listScheduledSessions() { return [{ id: "session-10", startsAt: "2026-10-01T09:00:00.000Z", timezone: "Asia/Singapore" }]; },
  } });
  assert.equal(isPackageSelectionIntent("book a math class", learningSession), false);
  const learningResult = await ask("book a math class", { context: learningContext, session: learningSession, adapter: {
    async listBookableServices() { return [{ id: 10, businessId: 42, slug: "math-class", name: "Math Class", bookingType: "class", schedulingMode: "scheduled", packageSessionCount: 10, packageValidityDays: 90, isActive: true, isPublished: true }]; },
    async listScheduledSessions() { return [{ id: "session-10", startsAt: "2026-10-01T09:00:00.000Z", timezone: "Asia/Singapore" }]; },
  } });
  assert.equal(learningSession.reservationFlow.journeyType, "scheduled_session");
  assert.equal(learningResult.reservation.flowStatus, "service_selection");

  const appointmentSession = {};
  const appointmentAdapter = {
    async listBookableServices() { return [{ id: 1, businessId: 42, slug: "physio-appointment", name: "Physio Appointment", bookingType: "appointment", isActive: true, isPublished: true }]; },
    async listBookableProviders() { return [{ id: 2, slug: "provider-1", displayName: "Provider One", timezone: "Asia/Singapore" }]; },
  };
  await ask("Show me packages", { session: appointmentSession, adapter: appointmentAdapter });
  assert.equal(isPackageSelectionIntent("book a physio appointment", appointmentSession), false);
  const appointmentResult = await ask("book a physio appointment", { session: appointmentSession, adapter: appointmentAdapter });
  assert.equal(appointmentSession.reservationFlow.journeyType, "appointment");
  assert.equal(appointmentResult.reservation.flowStatus, "provider_selection");
});

test("package wording does not replace active scheduled-session or Restaurant flows", async () => {
  const scheduledSession = { reservationFlow: { status: "slot_selection", journeyType: "scheduled_session", selectionOptions: [] } };
  const scheduledResult = await ask("What packages do you have?", { context: learningContext, session: scheduledSession });
  assert.match(scheduledResult.reply, /Available package options/);
  assert.equal(scheduledSession.reservationFlow.status, "slot_selection");
  assert.equal(scheduledSession.packageSelection, undefined);

  const restaurantSession = { reservationFlow: { status: "guest_count", journeyType: "restaurant", quantity: 2 } };
  const restaurantResult = await ask("I want a package", { context: contextFor({ services: false, teamResources: false, scheduledSessions: false, packages: true, guestCount: true }), session: restaurantSession });
  assert.match(restaurantResult.reply, /Available package options/);
  assert.equal(restaurantSession.reservationFlow.status, "guest_count");
  assert.equal(restaurantSession.packageSelection, undefined);
});

test("package false-positive cases remain ordinary booking or non-package conversation", () => {
  for (const message of [
    "I want a physio session",
    "book a physio appointment",
    "book a math class",
    "I want 10am physio",
    "what is session 10?",
    "10 sessions are showing on my account",
  ]) assert.equal(isPackageInformationIntent(message), false, message);
});

test("controller recognizes pending package selection and reset clears it", () => {
  const session = { packageSelection: { options: [{ serviceId: 1, slug: "physio", name: "Physio" }] } };
  assert.equal(shouldHandleTypedAppointment({ reservationEnabled: true, message: "1", session }), true);
  resetBookingSession(session);
  assert.equal(session.packageSelection, null);
});
