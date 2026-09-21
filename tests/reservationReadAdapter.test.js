import assert from "node:assert/strict";
import test from "node:test";
import { createReservationReadAdapter } from "../services/reservationReadAdapter.js";

const context = { reservationBusinessId: 42, reservationBusinessSlug: "tenant-a" };

const store = {
  getConfiguration: async () => ({ data: [{ business_id: 42, template_key: "general" }], error: null }),
  listServices: async () => ({ data: [{ id: 10, business_id: 42, slug: "consult", name: "Consultation", is_active: true, is_published: true, is_internal: false, duration_minutes: 45, price: 25, currency: "EUR", scheduling_mode: "generated" }], error: null }),
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
    capacity: null, packageSessionCount: null, packageValidityDays: null, enrollmentMode: null,
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
