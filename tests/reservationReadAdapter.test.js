import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduledSessionDateWindow, createReservationReadAdapter } from "../services/reservationReadAdapter.js";

const context = { reservationBusinessId: 42, reservationBusinessSlug: "tenant-a" };

const store = {
  getConfiguration: async () => ({ data: [{ business_id: 42, template_key: "general" }], error: null }),
  listServices: async () => ({ data: [{ id: 10, business_id: 42, slug: "consult", name: "Consultation", is_active: true, is_published: true, is_internal: false, duration_minutes: 45, price: 25, currency: "EUR", scheduling_mode: "generated", offer_as_package: false }], error: null }),
  listProviderAssignments: async () => ({ data: [{ staff_id: 20, service_id: 10, custom_duration_minutes: 60, custom_price: 30, is_active: true }], error: null }),
  listProviders: async () => ({ data: [{ id: 20, business_id: 42, slug: "dr-a", display_name: "Dr A", is_active: true, is_published: true, timezone: "Europe/Amsterdam" }], error: null }),
  getAvailableSlots: async () => ({ data: [{ starts_at: "2026-10-01T08:00:00Z", ends_at: "2026-10-01T09:00:00Z", local_time: "10:00:00" }], error: null }),
  getScheduledSessions: async () => ({ data: [{ session_id: 30, service_id: 10, starts_at: "2026-10-02T08:00:00Z", ends_at: "2026-10-02T09:00:00Z", remaining_capacity: 4 }], error: null }),
  getRestaurantSlots: async () => ({ data: [{ reservation_time: "19:00:00", remaining_capacity: 8, timezone: "UTC" }], error: null }),
  getCustomerForm: async () => ({ data: [{ id: 1, field_label: "Email", field_type: "email", is_active: true }], error: null }),
};

test("reads only canonical public service/provider projections", async () => {
  const adapter = createReservationReadAdapter(store);
  const services = await adapter.listBookableServices(context);
  assert.deepEqual(services[0], {
    id: 10, businessId: 42, slug: "consult", name: "Consultation", description: "",
    bookingType: null, durationMinutes: 45, price: 25, currency: "EUR", schedulingMode: "generated",
    capacity: null, packageSessionCount: null, packageValidityDays: null, offerAsPackage: false, enrollmentMode: null,
  });
  const providers = await adapter.listBookableProviders(context, services[0]);
  assert.equal(providers[0].id, 20);
  assert.equal(providers[0].customDurationMinutes, 60);
  assert.equal(providers[0].customPrice, 30);
});

test("normalizes availability, sessions, restaurant slots, and customer form without writes", async () => {
  const adapter = createReservationReadAdapter(store);
  const slots = await adapter.listAppointmentAvailability(context, { serviceId: 10, serviceSlug: "consult", providerId: 20, providerSlug: "dr-a", localDate: "2026-10-01" });
  assert.deepEqual(slots[0], { startsAt: "2026-10-01T08:00:00Z", endsAt: "2026-10-01T09:00:00Z", localTime: "10:00:00", timezone: null, businessId: 42, serviceId: 10, providerId: 20 });
  assert.equal((await adapter.listScheduledSessions(context, { serviceSlug: "consult", fromDate: "2026-10-01", toDate: "2026-10-31" }))[0].remainingCapacity, 4);
  assert.equal((await adapter.listRestaurantAvailability(context, "2026-10-01"))[0].remainingCapacity, 8);
  assert.equal((await adapter.getCustomerForm(context))[0].id, "1");
});

test("builds a deterministic UTC-safe 60-day scheduled-session window", () => {
  assert.deepEqual(buildScheduledSessionDateWindow({ now: new Date("2026-09-24T23:30:00-07:00") }), {
    fromDate: "2026-09-25",
    toDate: "2026-11-24",
  });
  assert.deepEqual(buildScheduledSessionDateWindow({ fromDate: "2026-09-24", toDate: "2026-09-30" }), {
    fromDate: "2026-09-24",
    toDate: "2026-09-30",
  });
});

test("sends the exact production-shaped scheduled-session RPC payload and preserves rows", async () => {
  const calls = [];
  const productionStore = {
    getScheduledSessions: async (args) => {
      calls.push(args);
      return {
        data: [{
          session_id: 300,
          starts_at: "2026-09-30T05:00:00Z",
          ends_at: "2026-09-30T06:00:00Z",
          staff_slug: "test-math-jane-lin",
          staff_name: "Test math Jane Lin",
          staff_timezone: "Asia/Manila",
          capacity: 5,
          remaining_capacity: 5,
        }],
        error: null,
      };
    },
  };
  const referenceNow = new Date("2026-09-24T12:00:00Z");
  const adapter = createReservationReadAdapter(productionStore, { now: () => referenceNow });
  const rows = await adapter.listScheduledSessions(
    { reservationBusinessSlug: "terrapeak" },
    { serviceSlug: "test-math-class", serviceId: 56 },
  );
  assert.deepEqual(calls, [{
    p_business_slug: "terrapeak",
    p_service_slug: "test-math-class",
    p_from_date: "2026-09-24",
    p_to_date: "2026-11-23",
  }]);
  assert.deepEqual(rows[0], {
    id: 300,
    serviceId: 56,
    startsAt: "2026-09-30T05:00:00Z",
    endsAt: "2026-09-30T06:00:00Z",
    timezone: "Asia/Manila",
    remainingCapacity: 5,
    staffName: "Test math Jane Lin",
  });
});

test("fails closed when a future RPC row contradicts the authoritative service identity", async () => {
  const adapter = createReservationReadAdapter({
    getScheduledSessions: async () => ({
      data: [{ session_id: 300, service_id: 99, starts_at: "2026-09-30T05:00:00Z", ends_at: "2026-09-30T06:00:00Z", remaining_capacity: 5 }],
      error: null,
    }),
  });
  await assert.rejects(
    () => adapter.listScheduledSessions(context, { serviceSlug: "test-math-class", serviceId: 56 }),
    /service identity mismatch/,
  );
});

test("rejects invalid explicit scheduled-session dates and preserves safe RPC errors", async () => {
  let calls = 0;
  const adapter = createReservationReadAdapter({
    getScheduledSessions: async () => {
      calls += 1;
      return { data: null, error: { code: "PGRST202", message: "internal detail" } };
    },
  });
  await assert.rejects(
    () => adapter.listScheduledSessions(context, { serviceSlug: "consult", fromDate: "09/24/2026" }),
    /valid YYYY-MM-DD date/,
  );
  await assert.rejects(
    () => adapter.listScheduledSessions(context, { serviceSlug: "consult", fromDate: "2026-09-24", toDate: "2026-09-23" }),
    /on or after the start date/,
  );
  await assert.rejects(
    () => adapter.listScheduledSessions(context, { serviceSlug: "consult", fromDate: "2026-09-24", toDate: "2026-99-99" }),
    /valid date on or after the start date/,
  );
  await assert.rejects(
    () => adapter.listScheduledSessions(context, { serviceSlug: "consult" }),
    (error) => error.message === "Reservations scheduled sessions could not be loaded." && error.code === "PGRST202",
  );
  assert.equal(calls, 1);
});

test("allows a same-day scheduled-session range and sends exact dates", async () => {
  const calls = [];
  const adapter = createReservationReadAdapter({
    getScheduledSessions: async (args) => {
      calls.push(args);
      return { data: [], error: null };
    },
  });
  await adapter.listScheduledSessions(context, {
    serviceSlug: "consult",
    fromDate: "2026-09-24",
    toDate: "2026-09-24",
  });
  assert.deepEqual(calls, [{
    p_business_slug: "tenant-a",
    p_service_slug: "consult",
    p_from_date: "2026-09-24",
    p_to_date: "2026-09-24",
  }]);
});
