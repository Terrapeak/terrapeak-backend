import assert from "node:assert/strict";
import test from "node:test";
import { handleAiReservationConversation } from "../services/aiReservationConversationService.js";
import { createReservationReadAdapter } from "../services/reservationReadAdapter.js";
import { createReservationWriteAdapter } from "../services/reservationWriteAdapter.js";
import { executeAiReservationBooking } from "../services/aiReservationBookingService.js";
import { fingerprintRestaurantBookingRequest } from "../utils/reservationRequestFingerprint.js";
import { isRestaurantReservationIntent } from "../services/aiReservationConversationService.js";

const context = {
  companyId: "company-restaurant",
  chatbotId: "chatbot-restaurant",
  sessionId: "session-restaurant",
  reservationBusinessId: 42,
  reservationBusinessSlug: "restaurant-test",
  configuration: {
    templateKey: "restaurant",
    capabilities: { services: false, teamResources: false, guestCount: true },
    bookingBehavior: { booking_behavior: "immediate" },
    terminology: { guestPlural: "guests" },
  },
};

const form = [
  { id: "name", label: "Full name", type: "text", systemKey: "name", required: true, active: true, order: 1 },
  { id: "phone", label: "Phone", type: "phone", systemKey: "phone", required: true, active: true, order: 2 },
  { id: "email", label: "Email", type: "email", systemKey: "email", required: true, active: true, order: 3 },
  { id: "special", label: "Special requests", type: "textarea", required: false, active: true, order: 4 },
];

const makeReadAdapter = ({ slots = [{ localTime: "19:00:00", startsAt: "2026-09-25T11:00:00.000Z", timezone: "Asia/Singapore", remainingCapacity: 10 }] } = {}) => ({
  async getRestaurantSettings() { return { timezone: "Asia/Singapore", maxGuests: 10, durationMinutes: 90 }; },
  async listRestaurantAvailability(_context, _date, quantity) { return slots.filter((slot) => slot.remainingCapacity >= quantity); },
  async getCustomerForm() { return form; },
});

test("restaurant starts with party size and never asks for service or provider", async () => {
  const session = {};
  const result = await handleAiReservationConversation({ context, session, message: "book", readAdapter: makeReadAdapter() });
  assert.equal(result.handled, true);
  assert.equal(session.reservationFlow.journeyType, "restaurant");
  assert.equal(session.reservationFlow.status, "guest_count");
  assert.match(result.reply, /how many guests/i);
  assert.doesNotMatch(result.reply, /service|provider/i);
});

test("meeting and callback wording is not classified as restaurant intent", () => {
  for (const message of [
    "Book a meeting for 4 people",
    "Schedule a video meeting for 3 people",
    "Request a callback for 2 people",
    "We have 4 people in our sales team",
    "Book a meeting with your consultant for 4 attendees",
  ]) assert.equal(isRestaurantReservationIntent(message), false, message);
});

test("restaurant wording with party size remains classified as restaurant intent", () => {
  for (const message of [
    "Book a table for 4 people",
    "Reserve a table for four people",
    "Restaurant reservation for 3 guests",
    "Dinner booking for 6 people",
    "Can I make a reservation for 4 guests?",
  ]) assert.equal(isRestaurantReservationIntent(message), true, message);
});

test("restaurant extracts party size and natural date/time from one request", async () => {
  const session = {};
  const result = await handleAiReservationConversation({
    context,
    session,
    message: "I would like to reserve a table tomorrow at 7pm for 2 people",
    readAdapter: makeReadAdapter(),
    now: () => new Date("2026-09-24T02:00:00.000Z"),
  });
  assert.equal(session.reservationFlow.quantity, 2);
  assert.equal(session.reservationFlow.localDate, "2026-09-25");
  assert.equal(session.reservationFlow.localTime, "19:00:00");
  assert.equal(session.reservationFlow.status, "customer_form");
  assert.match(result.reply, /full name/i);
});

test("restaurant rejects a party over the configured maximum without availability lookup", async () => {
  let availabilityReads = 0;
  const readAdapter = { ...makeReadAdapter(), async listRestaurantAvailability() { availabilityReads += 1; return []; } };
  const session = {};
  const result = await handleAiReservationConversation({ context, session, message: "reserve a table tomorrow for 11 guests", readAdapter, now: () => new Date("2026-09-24T02:00:00.000Z") });
  assert.match(result.reply, /up to 10/i);
  assert.equal(availabilityReads, 0);
});

test("restaurant no-slot response keeps the flow on date selection", async () => {
  const readAdapter = makeReadAdapter({ slots: [] });
  const session = {};
  const result = await handleAiReservationConversation({ context, session, message: "reserve a table tomorrow for 2 guests", readAdapter, now: () => new Date("2026-09-24T02:00:00.000Z") });
  assert.match(result.reply, /no restaurant times/i);
  assert.equal(session.reservationFlow.status, "date_selection");
});

test("restaurant customer form summary is explicit and does not use appointment concepts", async () => {
  const session = {};
  const readAdapter = makeReadAdapter();
  let result = await handleAiReservationConversation({ context, session, message: "reserve a table tomorrow at 7pm for 2", readAdapter, now: () => new Date("2026-09-24T02:00:00.000Z") });
  for (const message of ["Aisha Restaurant", "+31612345678", "aisha@example.com", "skip"]) {
    result = await handleAiReservationConversation({ context, session, message, readAdapter, model: makeAttemptModel() });
  }
  assert.equal(session.reservationFlow.status, "awaiting_confirmation");
  assert.match(result.reply, /Reservation summary/);
  assert.match(result.reply, /Guests: 2/);
  assert.match(result.reply, /Date: 2026-09-25/);
  assert.doesNotMatch(result.reply, /Service:|Provider:/);
});

test("restaurant read adapter filters slots by requested capacity and derives canonical start", async () => {
  const adapter = createReservationReadAdapter({
    async getRestaurantSlots() { return { data: [{ reservation_time: "19:00:00", remaining_capacity: 2, timezone: "Asia/Singapore" }, { reservation_time: "20:00:00", remaining_capacity: 6, timezone: "Asia/Singapore" }], error: null }; },
    async getCustomerForm() { return { data: [] }; },
  });
  const slots = await adapter.listRestaurantAvailability({ reservationBusinessId: 42, reservationBusinessSlug: "restaurant-test" }, "2026-09-25", 4);
  assert.deepEqual(slots.map((slot) => slot.localTime), ["20:00:00"]);
  assert.equal(slots[0].startsAt, "2026-09-25T12:00:00.000Z");
});

test("restaurant write adapter delegates to the canonical RPC", async () => {
  const calls = [];
  const adapter = createReservationWriteAdapter({ clientFactory: () => ({ async rpc(name, args) { calls.push({ name, args }); return { data: [{ id: "booking-1", reference: "BK-1", starts_at: "2026-09-25T11:00:00Z" }], error: null }; } }) });
  const result = await adapter.createRestaurantBooking({ reservationBusinessId: 42, reservationBusinessSlug: "restaurant-test", localDate: "2026-09-25", localTime: "19:00:00", quantity: 2, customerName: "Aisha", customerPhone: "+31612345678", customerEmail: "aisha@example.com", customData: {}, idempotencyKey: "company-restaurant:attempt-1" });
  assert.equal(result.reference, "BK-1");
  assert.equal(calls[0].name, "create_canonical_restaurant_booking");
  assert.equal(calls[0].args.p_quantity, 2);
});

test("restaurant booking service revalidates and writes once after confirmation", async () => {
  const flow = { status: "awaiting_confirmation", journeyType: "restaurant", companyId: context.companyId, chatbotId: context.chatbotId, businessId: "42", bookingAttemptId: "attempt-1", idempotencyKey: "company-restaurant:attempt-1", localDate: "2026-09-25", localTime: "19:00:00", startsAt: "2026-09-25T11:00:00.000Z", timezone: "Asia/Singapore", quantity: 2, customer: { name: "Aisha", email: "aisha@example.com", phone: "+31612345678" }, customData: {}, customerFormSnapshot: form, confirmation: { summary: { journeyType: "restaurant" } } };
  const fingerprint = fingerprintRestaurantBookingRequest({ ...flow, reservationBusinessId: 42, reservationBusinessSlug: "restaurant-test", customerName: "Aisha", customerEmail: "aisha@example.com", customerPhone: "+31612345678", customData: {} }).fingerprint;
  const model = makeAttemptModel({ companyId: context.companyId, chatbotId: context.chatbotId, sessionId: context.sessionId, bookingAttemptId: "attempt-1", idempotencyKey: flow.idempotencyKey, requestFingerprint: fingerprint, status: "draft" });
  let writes = 0;
  const result = await executeAiReservationBooking({ context, session: { reservationFlow: flow }, model, contextResolver: async () => context, readAdapter: makeReadAdapter(), writeAdapter: { async createRestaurantBooking() { writes += 1; return { bookingId: "booking-1", reference: "BK-1" }; }, async findByIdempotencyKey() { return null; } } });
  assert.equal(result.bookingCreated, true);
  assert.equal(writes, 1);
  assert.equal(model.rows[0].status, "completed");
});

function makeAttemptModel(initial = null) {
  const rows = initial ? [initial] : [];
  const matches = (row, query) => Object.entries(query).every(([key, value]) => {
    if (key === "$or") return value.some((candidate) => Object.entries(candidate).every(([nested, expected]) => nested.split(".").reduce((item, part) => item?.[part], row) === expected));
    if (key === "status" && value?.$in) return value.$in.includes(row.status);
    if (key === "_id") return row._id === value;
    return String(row[key]) === String(value);
  });
  return {
    rows,
    async findOne(query) { return rows.find((row) => matches(row, query)) || null; },
    async create(row) { rows.push({ ...row }); return rows.at(-1); },
    async findOneAndUpdate(query, update) { const row = rows.find((item) => matches(item, query)); if (!row) return null; Object.assign(row, update.$set || {}); return row; },
  };
}
