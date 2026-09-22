import assert from "node:assert/strict";
import test from "node:test";
import { createReservationWriteAdapter } from "../services/reservationWriteAdapter.js";
import { fingerprintReservationBookingRequest } from "../utils/reservationRequestFingerprint.js";

test("appointment write adapter calls only the canonical idempotent appointment RPC", async () => {
  const calls = [];
  const events = [];
  const originalInfo = console.info;
  console.info = (value) => events.push(JSON.parse(value));
  const adapter = createReservationWriteAdapter({
    clientFactory: () => ({
      async rpc(name, args) {
        calls.push({ name, args });
        return { data: [{ booking_id: "booking-1", reference: "BK-1", starts_at: "2099-01-15T09:00:00Z", ends_at: "2099-01-15T10:00:00Z" }], error: null };
      },
    }),
  });
  let result;
  try {
    result = await adapter.createAppointment({
      reservationBusinessSlug: "tenant-a", serviceSlug: "consultation", providerSlug: "dr-a",
      startsAt: "2099-01-15T09:00:00Z", customerName: "Aisha", customerEmail: "aisha@example.com",
      customerPhone: "+31612345678", customData: { "7": "First visit" }, idempotencyKey: "company-1:attempt-1",
    });
  } finally {
    console.info = originalInfo;
  }
  assert.equal(result.reference, "BK-1");
  assert.deepEqual(calls, [{
    name: "create_public_booking_idempotent",
    args: {
      p_business_slug: "tenant-a", p_service_slug: "consultation", p_staff_slug: "dr-a",
      p_starts_at: "2099-01-15T09:00:00Z", p_customer_name: "Aisha", p_customer_email: "aisha@example.com",
      p_customer_phone: "+31612345678", p_notes: null, p_custom_data: { "7": "First visit" },
      p_idempotency_key: "company-1:attempt-1",
      p_request_fingerprint: fingerprintReservationBookingRequest({
        reservationBusinessSlug: "tenant-a", serviceSlug: "consultation", providerSlug: "dr-a",
        startsAt: "2099-01-15T09:00:00Z", customerName: "Aisha", customerEmail: "aisha@example.com",
        customerPhone: "+31612345678", notes: null, customData: { "7": "First visit" },
      }).fingerprint,
    },
  }]);
  assert.deepEqual(events.map(({ event }) => event), ["reservation_write_rpc_start", "reservation_performance_stage", "reservation_write_rpc_success"]);
  assert.equal(events[0].idempotencyKeyHash, "60aaccc7aac265c4");
  assert.doesNotMatch(JSON.stringify(events), /Aisha|aisha@example.com|31612345678|First visit/);
});

test("same idempotency key with a different payload is mapped to a stable conflict", async () => {
  const adapter = createReservationWriteAdapter({
    clientFactory: () => ({ async rpc() { return { data: null, error: { code: "P0001", message: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" } }; } }),
  });
  await assert.rejects(
    adapter.createAppointment({ reservationBusinessSlug: "tenant-a", serviceSlug: "s", providerSlug: "p", startsAt: "2099-01-15T09:00:00Z", customerName: "A", customerPhone: "123456", idempotencyKey: "company-1:attempt-1" }),
    (error) => error.code === "IDEMPOTENCY_REQUEST_CONFLICT" && error.ambiguous === false,
  );
});

test("ambiguous lookup returns the stored fingerprint for reconciliation", async () => {
  const adapter = createReservationWriteAdapter({
    clientFactory: () => ({ async rpc(name) {
      assert.equal(name, "get_public_booking_by_idempotency_key");
      return { data: [{ booking_id: "booking-1", reference: "BK-1", starts_at: "2099-01-15T09:00:00Z", ends_at: "2099-01-15T10:00:00Z", booking_status: "confirmed", business_id: 42, request_fingerprint: "fingerprint-1" }], error: null };
    } }),
  });
  assert.deepEqual(await adapter.findByIdempotencyKey({ reservationBusinessSlug: "tenant-a", idempotencyKey: "company-1:attempt-1" }), {
    bookingId: "booking-1", reference: "BK-1", startsAt: "2099-01-15T09:00:00Z", endsAt: "2099-01-15T10:00:00Z", status: "confirmed", businessId: 42, requestFingerprint: "fingerprint-1",
  });
});

test("ambiguous adapter failures are explicitly marked and not converted to success", async () => {
  const events = [];
  const originalInfo = console.info;
  console.info = (value) => events.push(JSON.parse(value));
  const adapter = createReservationWriteAdapter({
    clientFactory: () => ({ async rpc() { return { data: null, error: { message: "timeout" } }; } }),
  });
  try {
    await assert.rejects(
      adapter.createAppointment({ reservationBusinessSlug: "tenant-a", serviceSlug: "s", providerSlug: "p", startsAt: "2099-01-15T09:00:00Z", customerName: "A", customerPhone: "123456", idempotencyKey: "company-1:attempt-1" }),
      (error) => error.code === "RESERVATIONS_WRITE_AMBIGUOUS" && error.ambiguous === true,
    );
  } finally {
    console.info = originalInfo;
  }
  assert.equal(events.at(-1).event, "reservation_write_rpc_failed");
  assert.equal(events.at(-1).mappedErrorCode, "RESERVATIONS_WRITE_AMBIGUOUS");
  assert.equal(events.at(-1).ambiguous, true);
});
