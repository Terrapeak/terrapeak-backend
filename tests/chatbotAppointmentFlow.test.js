import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

process.env.ALLOW_FAKE_GOOGLE_MEET = "true";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
globalThis.fetch = async () =>
  new Response(JSON.stringify([{ id: 42, business_slug: "test-business" }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const {
  askGemini,
  detectBookingIntent,
  isSpecificAppointmentRequest,
  shouldHandleTypedAppointment,
} = await import(
  "../controllers/chatbotController.js"
);
const ChatbotSettings = (await import("../models/chatbotSettings.js")).default;
const Company = (await import("../models/company.js")).default;
const CompanyAppInstallation = (await import(
  "../models/companyAppInstallation.js"
)).default;
const Session = (await import("../models/sessionModel.js")).default;
const TimeSlot = (await import("../models/timeSlot.js")).default;
const Appointment = (await import("../models/appointment.js")).default;
const ReservationStaffRequest = (await import(
  "../models/reservationStaffRequest.js"
)).default;

const ownerId = new mongoose.Types.ObjectId();
const chatbotId = new mongoose.Types.ObjectId();

function chain(value) {
  return {
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
    select() {
      return this;
    },
    lean: async () => value,
  };
}

function installChatbotMocks(t, { reservationEnabled = true, timeSlot } = {}) {
  const settings = {
    _id: chatbotId,
    userId: ownerId,
    companyId: new mongoose.Types.ObjectId(),
    apiKey: "test-api-key",
    geminiKey: "test-gemini-key",
    gemini_model: "test-model",
    reservationEnabled,
    brandName: "Test business",
    botName: "Test bot",
  };
  const company = {
    reservationBusinessId: 42,
    reservationBusinessSlug: "test-business",
    reservationTemplate: "general",
    isActive: true,
  };
  const installation = { _id: new mongoose.Types.ObjectId() };
  let sessionDocument = null;

  t.mock.method(ChatbotSettings, "findOne", async () => settings);
  t.mock.method(Company, "findById", () => chain(company));
  t.mock.method(CompanyAppInstallation, "findOne", () => chain(installation));
  t.mock.method(Session, "findOne", async () => sessionDocument);
  t.mock.method(Session.prototype, "save", async function save() {
    sessionDocument = this;
  });
  t.mock.method(Appointment.prototype, "save", async function save() {
    this.__saved = true;
  });
  t.mock.method(TimeSlot.prototype, "save", async function save() {
    this.__saved = true;
  });
  t.mock.method(TimeSlot, "find", async (query) => {
    assert.deepEqual(query.userId, ownerId);
    assert.equal(query.isBooked, false);
    return timeSlot ? [timeSlot] : [];
  });
  t.mock.method(TimeSlot, "findById", async () => timeSlot);

  return { settings, getSession: () => sessionDocument };
}

async function sendMessage(t, message, userId = null, chatReservationContext = null) {
  const response = {};
  response.json = (body) => {
    response.body = body;
  };
  const request = {
      body: {
        sessionId: "anonymous-appointment-session",
        chatbotId: chatbotId.toString(),
        userId,
        message,
        chatHistory: [],
        timeZone: "Asia/Singapore",
        isPreview: true,
      },
      headers: { "x-api-key": "test-api-key" },
  };
  if (chatReservationContext) request.chatReservationContext = chatReservationContext;
  await askGemini(request, response,
    (error) => {
      throw error;
    },
  );
  assert.ok(response.body, `Expected a response for ${message}`);
  return response.body;
}

test("anonymous visitor appointment availability is queried by chatbot owner", async (t) => {
  const slot = new TimeSlot({
    userId: ownerId,
    start: new Date("2099-01-15T09:00:00.000Z"),
    end: new Date("2099-01-15T10:00:00.000Z"),
    timeZone: "Asia/Singapore",
    isBooked: false,
  });
  const { getSession } = installChatbotMocks(t, { timeSlot: slot });

  const first = await sendMessage(t, "meeting");
  assert.equal(first.bookingType, "appointment");
  assert.equal(first.appointmentStep, "confirm");

  getSession().lastGeminiCall = 0;
  const confirmed = await sendMessage(t, "yes");
  assert.equal(confirmed.appointmentStep, "askDate");

  getSession().lastGeminiCall = 0;
  const available = await sendMessage(t, "2099-01-15");
  assert.equal(available.appointmentStep, "chooseSlot");
  assert.match(available.reply, /available slots/i);
});

test("a visitor identity cannot redirect availability away from the owner", async (t) => {
  const slot = new TimeSlot({
    userId: ownerId,
    start: new Date("2099-01-15T09:00:00.000Z"),
    end: new Date("2099-01-15T10:00:00.000Z"),
    timeZone: "Asia/Singapore",
    isBooked: false,
  });
  const unrelatedVisitorId = new mongoose.Types.ObjectId();
  const { getSession } = installChatbotMocks(t, { timeSlot: slot });

  await sendMessage(t, "meeting", unrelatedVisitorId);
  getSession().lastGeminiCall = 0;
  await sendMessage(t, "yes", unrelatedVisitorId);
  getSession().lastGeminiCall = 0;
  const available = await sendMessage(t, "2099-01-15", unrelatedVisitorId);

  assert.equal(available.appointmentStep, "chooseSlot");
  assert.match(available.reply, /available slots/i);
});

test("owner availability absence returns a controlled no-availability response", async (t) => {
  const { getSession } = installChatbotMocks(t);

  await sendMessage(t, "meeting");
  getSession().lastGeminiCall = 0;
  await sendMessage(t, "yes");
  getSession().lastGeminiCall = 0;
  const unavailable = await sendMessage(t, "2099-01-15");

  assert.equal(unavailable.appointmentStep, "askDate");
  assert.match(unavailable.reply, /no available slots/i);
});

test("anonymous visitor can complete appointment creation with mocked Google Meet", async (t) => {
  const slot = new TimeSlot({
    userId: ownerId,
    start: new Date("2099-01-15T09:00:00.000Z"),
    end: new Date("2099-01-15T10:00:00.000Z"),
    timeZone: "Asia/Singapore",
    isBooked: false,
  });
  const { getSession } = installChatbotMocks(t, { timeSlot: slot });

  let firstMessage = true;
  for (const [message, expectedStep] of [
    ["meeting", "confirm"],
    ["yes", "askDate"],
    ["2099-01-15", "chooseSlot"],
    ["1", "askName"],
    ["Anonymous Visitor", "askEmail"],
    ["visitor@example.com", "askPhone"],
  ]) {
    if (!firstMessage) getSession().lastGeminiCall = 0;
    const result = await sendMessage(t, message);
    assert.equal(result.appointmentStep, expectedStep, message);
    firstMessage = false;
  }

  getSession().lastGeminiCall = 0;
  const completed = await sendMessage(t, "+65 8123 4567");
  assert.equal(completed.success, true);
  assert.equal(completed.appointmentStep, null);
  assert.equal(getSession().bookingType, "appointment");
  assert.equal(slot.isBooked, true);
});

test("callback requests retain Reservations callback precedence", async (t) => {
  const { getSession } = installChatbotMocks(t);

  let firstMessage = true;
  for (const message of ["request callback", "call me", "contact me"]) {
    if (!firstMessage) getSession().lastGeminiCall = 0;
    const result = await sendMessage(t, message);
    assert.equal(result.bookingType, "reservation", message);
    assert.equal(getSession().reservationCallbackStep, "askName", message);
    getSession().bookingType = null;
    getSession().reservationCallbackStep = null;
    firstMessage = false;
  }
});

test("callback persistence keeps rich staff context out of the customer reply", async (t) => {
  const { getSession } = installChatbotMocks(t);
  let savedRequest = null;
  t.mock.method(ReservationStaffRequest, "create", async (payload) => {
    savedRequest = payload;
    return payload;
  });

  await sendMessage(t, "request callback");
  assert.equal(getSession().reservationCallbackBookingUrl, null);

  for (const message of [
    "Test Customer",
    "test@example.com",
    "9 PM",
    "I have a private customer question",
  ]) {
    getSession()?.lastGeminiCall && (getSession().lastGeminiCall = 0);
    await sendMessage(t, message);
  }

  getSession().lastGeminiCall = 0;
  const completed = await sendMessage(t, "Acceptance Test Service");
  assert.ok(savedRequest);
  assert.match(savedRequest.summary, /Conversation context|Recent transcript/);
  assert.match(completed.reply, /sent your callback request/i);
  assert.doesNotMatch(completed.reply, /Conversation context|Recent transcript|private customer question/i);
  assert.equal(getSession().bookingType, "reservation");
});

test("callback flow can be cancelled without continuing callback prompts", async (t) => {
  const { getSession } = installChatbotMocks(t);

  await sendMessage(t, "request callback");
  await sendMessage(t, "Test Customer");

  getSession().lastGeminiCall = 0;
  const cancelled = await sendMessage(t, "cancel");

  assert.match(cancelled.reply, /cancelled the current reservation process/i);
  assert.equal(getSession().bookingType, null);
  assert.equal(getSession().reservationCallbackStep, null);
  assert.equal(getSession().reservationCallbackName, null);
  assert.equal(getSession().reservationCallbackContact, null);

  getSession().lastGeminiCall = 0;
  const followUp = await sendMessage(t, "where is terrapeak based?");

  assert.doesNotMatch(followUp.reply, /phone number|email|good time/i);
  assert.equal(getSession().reservationCallbackStep, null);
});

test("reservation booking requests do not require Gemini configuration", async (t) => {
  const { settings, getSession } = installChatbotMocks(t);
  settings.geminiKey = "";
  settings.gemini_model = "";

  const result = await sendMessage(t, "i want to make a booking");

  assert.equal(result.success, true);
  assert.match(result.reply, /Reservations form/i);
  assert.doesNotMatch(result.reply, /Configuration required/i);
  assert.equal(getSession().bookingType, "reservation");
});

test("service-specific appointment requests enter the typed Reservations flow", () => {
  assert.equal(isSpecificAppointmentRequest("I want to book Acceptance Test Service"), true);
  assert.equal(isSpecificAppointmentRequest("schedule the Acceptance Test Service"), true);
  assert.equal(isSpecificAppointmentRequest("I want to make a booking"), false);
  assert.equal(isSpecificAppointmentRequest("book a table"), false);
  assert.equal(isSpecificAppointmentRequest("schedule a meeting"), false);
  assert.equal(
    shouldHandleTypedAppointment({
      reservationEnabled: true,
      message: "I want to book Acceptance Test Service",
      session: {},
    }),
    true,
  );
  assert.equal(
    shouldHandleTypedAppointment({
      reservationEnabled: true,
      message: "I want to book a table",
      session: {},
    }),
    false,
  );
});

test("controller routes a service-specific request to canonical R2B service selection", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  installChatbotMocks(t);
  let configurationCalls = 0;

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/rpc/get_public_reservations_configuration")) {
      configurationCalls += 1;
      return new Response(JSON.stringify([{
        business_id: 42,
        template_key: "general",
        capabilities: { services: true },
        terminology: {},
        booking_behavior: "immediate",
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/rest/v1/services")) {
      return new Response(JSON.stringify([{
        id: 101,
        business_id: 42,
        name: "Acceptance Test Service",
        slug: "acceptance-test-service",
        booking_type: "appointment",
        duration_minutes: 60,
        is_active: true,
        is_published: true,
        is_internal: false,
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected Reservations read: ${target}`);
  };

  const result = await sendMessage(t, "I want to book Acceptance Test Service");

  assert.ok(result.reservation, JSON.stringify(result));
  assert.equal(result.reservation.flowStatus, "service_selection");
  assert.match(result.reply, /1\. Acceptance Test Service/);
  assert.doesNotMatch(result.reply, /reservation or meeting|Reservations form/i);
  assert.equal(result.bookingType, null);
  assert.equal(configurationCalls, 1);
});

test("first typed R2B turn reuses a correctly bound middleware context", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  const { settings } = installChatbotMocks(t);
  const telemetry = [];
  t.mock.method(console, "info", (line) => {
    const event = JSON.parse(line);
    if (event.event === "reservation_context_source") telemetry.push(event);
  });
  let configurationCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/rest/v1/services")) {
      return new Response(JSON.stringify([{
        id: 101,
        business_id: 42,
        name: "Acceptance Test Service",
        slug: "acceptance-test-service",
        booking_type: "appointment",
        duration_minutes: 60,
        is_active: true,
        is_published: true,
        is_internal: false,
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("get_public_reservations_configuration")) {
      configurationCalls += 1;
      return new Response(JSON.stringify([{
        business_id: 42,
        template_key: "general",
        capabilities: { services: true },
        terminology: {},
        booking_behavior: "immediate",
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected Reservations read: ${target}`);
  };
  const middlewareContext = {
    sessionId: "anonymous-appointment-session",
    chatbotId: chatbotId.toString(),
    companyId: settings.companyId.toString(),
    installationId: "installation-1",
    reservationBusinessId: 42,
    reservationBusinessSlug: "test-business",
    configuration: {
      templateKey: "general",
      capabilities: { services: true },
      bookingBehavior: { booking_behavior: "immediate" },
    },
  };
  const result = await sendMessage(t, "I want to book Acceptance Test Service", null, middlewareContext);

  assert.equal(result.reservation.flowStatus, "service_selection");
  assert.equal(configurationCalls, 0);
  assert.equal(telemetry.at(-1)?.contextSource, "middleware");
});

test("invalid middleware context falls back to one fresh controller resolution", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  const { settings } = installChatbotMocks(t);
  let configurationCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/rest/v1/services")) {
      return new Response(JSON.stringify([{
        id: 101,
        business_id: 42,
        name: "Acceptance Test Service",
        slug: "acceptance-test-service",
        booking_type: "appointment",
        duration_minutes: 60,
        is_active: true,
        is_published: true,
        is_internal: false,
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("get_public_reservations_configuration")) {
      configurationCalls += 1;
      return new Response(JSON.stringify([{
        business_id: 42,
        template_key: "general",
        capabilities: { services: true },
        terminology: {},
        booking_behavior: "immediate",
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected Reservations read: ${target}`);
  };
  const middlewareContext = {
    sessionId: "anonymous-appointment-session",
    chatbotId: chatbotId.toString(),
    companyId: settings.companyId.toString(),
    installationId: "installation-1",
    reservationBusinessId: 42,
    reservationBusinessSlug: "test-business",
    configuration: {
      templateKey: "general",
      capabilities: { services: true },
      bookingBehavior: { booking_behavior: "immediate" },
    },
  };
  const mismatchedContext = { ...middlewareContext, reservationBusinessId: 999 };

  const result = await sendMessage(t, "I want to book Acceptance Test Service", null, mismatchedContext);

  assert.equal(result.reservation.flowStatus, "service_selection");
  assert.equal(configurationCalls, 1);
});

test("meeting phrases select the scheduled appointment flow", () => {
  for (const message of [
    "meeting",
    "video meeting",
    "video call",
    "google meet",
    "zoom",
    "schedule a call",
  ]) {
    assert.equal(detectBookingIntent(message), "appointment", message);
  }
});

test("appointment intent does not replace Reservations reservation intent", () => {
  assert.equal(detectBookingIntent("book a table"), "reservation");
  assert.equal(detectBookingIntent("restaurant reservation"), "reservation");
  assert.equal(detectBookingIntent("i want to make a booking"), "reservation");
  assert.equal(detectBookingIntent("how do i sign up"), "reservation");
});

