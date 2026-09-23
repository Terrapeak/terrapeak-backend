import assert from "node:assert/strict";
import test from "node:test";
import { parseNaturalReservationDate } from "../utils/aiReservationDateParser.js";
import { handleAiReservationConversation } from "../services/aiReservationConversationService.js";

const at = "2026-09-23T16:30:00.000Z";

test("structured reservation dates remain canonical", () => {
  assert.deepEqual(parseNaturalReservationDate("2026-09-24"), { valid: true, value: "2026-09-24", message: null });
  assert.deepEqual(parseNaturalReservationDate("2026.09.24"), { valid: true, value: "2026-09-24", message: null });
  assert.deepEqual(parseNaturalReservationDate("2026/09/24"), { valid: true, value: "2026-09-24", message: null });
});

test("today and tomorrow use the authoritative business timezone at a UTC boundary", () => {
  assert.equal(parseNaturalReservationDate("today", { timezone: "Asia/Kuala_Lumpur", now: new Date(at) }).value, "2026-09-24");
  assert.equal(parseNaturalReservationDate("tomorrow", { timezone: "Asia/Kuala_Lumpur", now: new Date(at) }).value, "2026-09-25");
  assert.equal(parseNaturalReservationDate("today", { timezone: "America/Los_Angeles", now: new Date(at) }).value, "2026-09-23");
});

test("weekday semantics are deterministic: bare is upcoming and next is following week", () => {
  const options = { timezone: "Asia/Kuala_Lumpur", now: new Date(at) };
  assert.equal(parseNaturalReservationDate("Monday", options).value, "2026-09-28");
  assert.equal(parseNaturalReservationDate("Friday", options).value, "2026-09-25");
  assert.equal(parseNaturalReservationDate("next Monday", options).value, "2026-10-05");
  assert.equal(parseNaturalReservationDate("next Friday", options).value, "2026-10-02");
});

test("bare weekday includes the current local day while next weekday advances a week", () => {
  const options = { timezone: "Asia/Kuala_Lumpur", now: new Date("2026-09-24T16:30:00.000Z") };
  assert.equal(parseNaturalReservationDate("Friday", options).value, "2026-09-25");
  const fridayOptions = { timezone: "Asia/Kuala_Lumpur", now: new Date("2026-09-25T00:00:00.000Z") };
  assert.equal(parseNaturalReservationDate("Friday", fridayOptions).value, "2026-09-25");
  assert.equal(parseNaturalReservationDate("next Friday", fridayOptions).value, "2026-10-02");
});

test("month-name dates use the current year until passed, then roll forward", () => {
  const options = { timezone: "Asia/Kuala_Lumpur", now: new Date(at) };
  assert.equal(parseNaturalReservationDate("24 September", options).value, "2026-09-24");
  assert.equal(parseNaturalReservationDate("September 24", options).value, "2026-09-24");
  assert.equal(parseNaturalReservationDate("24 Sep", options).value, "2026-09-24");
  assert.equal(parseNaturalReservationDate("Sep 24", options).value, "2026-09-24");
  assert.equal(parseNaturalReservationDate("24 September", { ...options, now: new Date("2026-09-25T00:00:00Z") }).value, "2027-09-24");
});

test("leap-year month dates are accepted safely and non-leap dates roll to the next valid occurrence", () => {
  assert.equal(parseNaturalReservationDate("29 February", { timezone: "Asia/Kuala_Lumpur", now: new Date("2028-02-01T00:00:00Z") }).value, "2028-02-29");
  assert.equal(parseNaturalReservationDate("2028-02-29").value, "2028-02-29");
  assert.equal(parseNaturalReservationDate("29 February", { timezone: "Asia/Kuala_Lumpur", now: new Date("2027-02-01T00:00:00Z") }).value, "2028-02-29");
});

test("impossible, unsupported, and timezone-less natural dates fail safely", () => {
  const options = { timezone: "Asia/Kuala_Lumpur", now: new Date(at) };
  assert.equal(parseNaturalReservationDate("31 February", options).valid, false);
  assert.equal(parseNaturalReservationDate("31 September", options).valid, false);
  assert.equal(parseNaturalReservationDate("next week", options).valid, false);
  assert.equal(parseNaturalReservationDate("24/09/26", options).valid, false);
  assert.equal(parseNaturalReservationDate("today", { now: new Date(at) }).valid, false);
});

test("natural date selection sends canonical date to availability and advances normally", async () => {
  const calls = [];
  const session = { reservationFlow: {
    status: "date_selection",
    serviceId: "service-1",
    serviceSlug: "consultation",
    providerId: "provider-1",
    providerSlug: "dr-a",
    timezone: "Asia/Kuala_Lumpur",
  } };
  const result = await handleAiReservationConversation({
    context: { configuration: { bookingBehavior: { booking_behavior: "immediate" } } },
    session,
    message: "tomorrow",
    now: () => new Date(at),
    model: { async generateContent() { throw new Error("Gemini must not be called for deterministic dates"); } },
    readAdapter: {
      async listAppointmentAvailability(_context, args) {
        calls.push(args);
        return [{ startsAt: "2026-09-25T01:00:00.000Z", localTime: "09:00", timezone: "Asia/Kuala_Lumpur" }];
      },
    },
  });
  assert.equal(result.handled, true);
  assert.equal(session.reservationFlow.status, "slot_selection");
  assert.deepEqual(calls, [{ serviceId: "service-1", serviceSlug: "consultation", providerId: "provider-1", providerSlug: "dr-a", localDate: "2026-09-25", timezone: "Asia/Kuala_Lumpur" }]);
});

test("provider timezone is persisted for the date-selection turn", async () => {
  const session = {
    reservationFlow: {
      status: "provider_selection",
      serviceId: "service-1",
      serviceSlug: "consultation",
      serviceName: "Consultation",
      selectionOptions: [{ id: "provider-1", slug: "dr-a", displayName: "Dr A", timezone: "Asia/Kuala_Lumpur" }],
    },
  };
  const result = await handleAiReservationConversation({
    context: { configuration: { bookingBehavior: { booking_behavior: "immediate" } } },
    session,
    message: "1",
    readAdapter: { async listAppointmentAvailability() { return []; } },
  });
  assert.equal(result.handled, true);
  assert.equal(session.reservationFlow.status, "date_selection");
  assert.equal(session.reservationFlow.timezone, "Asia/Kuala_Lumpur");
});

test("invalid natural date does not read availability or advance the flow", async () => {
  let availabilityCalls = 0;
  const session = { reservationFlow: {
    status: "date_selection", serviceId: "service-1", serviceSlug: "consultation", providerId: "provider-1", providerSlug: "dr-a", timezone: "Asia/Kuala_Lumpur",
  } };
  const result = await handleAiReservationConversation({
    context: { configuration: { bookingBehavior: { booking_behavior: "immediate" } } },
    session,
    message: "next week",
    readAdapter: { async listAppointmentAvailability() { availabilityCalls += 1; return []; } },
  });
  assert.equal(session.reservationFlow.status, "date_selection");
  assert.equal(availabilityCalls, 0);
  assert.match(result.reply, /tomorrow|next Monday|24 September|YYYY-MM-DD/);
});

const dateSelectionSession = (timezone) => ({ reservationFlow: {
  status: "date_selection",
  serviceId: "service-1",
  serviceSlug: "consultation",
  serviceName: "Consultation",
  providerId: "provider-1",
  providerSlug: "dr-a",
  providerName: "Dr A",
  timezone,
} });

test("invalid provider timezone fails closed without losing the active flow or calling Gemini", async () => {
  let availabilityCalls = 0;
  let geminiCalls = 0;
  const session = dateSelectionSession("Invalid/Nowhere");
  const result = await handleAiReservationConversation({
    context: { configuration: { bookingBehavior: { booking_behavior: "immediate" } } },
    session,
    message: "tomorrow",
    model: { async generateContent() { geminiCalls += 1; throw new Error("Gemini must not be called"); } },
    readAdapter: { async listAppointmentAvailability() { availabilityCalls += 1; return []; } },
  });
  assert.equal(result.handled, true);
  assert.equal(session.reservationFlow.status, "date_selection");
  assert.equal(session.reservationFlow.serviceId, "service-1");
  assert.equal(session.reservationFlow.providerId, "provider-1");
  assert.equal(session.reservationFlow.timezone, "Invalid/Nowhere");
  assert.equal(availabilityCalls, 0);
  assert.equal(geminiCalls, 0);
  assert.match(result.reply, /YYYY-MM-DD/);
});

test("missing provider timezone preserves state and fails closed for natural dates", async () => {
  let availabilityCalls = 0;
  let geminiCalls = 0;
  const session = dateSelectionSession(null);
  const result = await handleAiReservationConversation({
    context: { configuration: { bookingBehavior: { booking_behavior: "immediate" } } },
    session,
    message: "tomorrow",
    model: { async generateContent() { geminiCalls += 1; throw new Error("Gemini must not be called"); } },
    readAdapter: { async listAppointmentAvailability() { availabilityCalls += 1; return []; } },
  });
  assert.equal(result.handled, true);
  assert.equal(session.reservationFlow.status, "date_selection");
  assert.equal(session.reservationFlow.serviceId, "service-1");
  assert.equal(session.reservationFlow.providerId, "provider-1");
  assert.equal(session.reservationFlow.timezone, null);
  assert.equal(session.reservationFlow.localDate, undefined);
  assert.equal(session.reservationFlow.startsAt, undefined);
  assert.equal(session.reservationFlow.localTime, undefined);
  assert.equal(session.reservationFlow.bookingAttemptId, undefined);
  assert.equal(session.reservationFlow.idempotencyKey, undefined);
  assert.equal(availabilityCalls, 0);
  assert.equal(geminiCalls, 0);
  assert.match(result.reply, /YYYY-MM-DD/);
});

test("structured dates remain accepted without a provider timezone", async () => {
  const calls = [];
  const session = dateSelectionSession(null);
  const result = await handleAiReservationConversation({
    context: { configuration: { bookingBehavior: { booking_behavior: "immediate" } } },
    session,
    message: "2026-09-24",
    model: { async generateContent() { throw new Error("Gemini must not be called"); } },
    readAdapter: {
      async listAppointmentAvailability(_context, args) {
        calls.push(args);
        return [{ startsAt: "2026-09-24T01:00:00.000Z", localTime: "09:00", timezone: null }];
      },
    },
  });
  assert.equal(result.handled, true);
  assert.equal(session.reservationFlow.status, "slot_selection");
  assert.equal(session.reservationFlow.localDate, "2026-09-24");
  assert.deepEqual(calls, [{ serviceId: "service-1", serviceSlug: "consultation", providerId: "provider-1", providerSlug: "dr-a", localDate: "2026-09-24", timezone: null }]);
});
