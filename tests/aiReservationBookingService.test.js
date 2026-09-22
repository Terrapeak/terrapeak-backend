import assert from "node:assert/strict";
import test from "node:test";
import { executeAiReservationBooking } from "../services/aiReservationBookingService.js";
import { fingerprintReservationBookingRequest } from "../utils/reservationRequestFingerprint.js";

const context = {
  companyId: "company-1",
  chatbotId: "chatbot-1",
  sessionId: "session-1",
  reservationBusinessId: 42,
  reservationBusinessSlug: "tenant-a",
  configuration: { templateKey: "general", capabilities: { services: true } },
};

const freshContext = { ...context, configuration: { templateKey: "general", capabilities: { services: true } } };
const flow = {
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
  startsAt: "2099-01-15T09:00:00.000Z",
  timezone: "UTC",
  customer: { name: "Aisha", email: "aisha@example.com", phone: "+31612345678" },
  customData: {},
  confirmation: { summary: {} },
};
const bookingFingerprint = fingerprintReservationBookingRequest({
  reservationBusinessSlug: "tenant-a", serviceSlug: "consultation", providerSlug: "dr-a",
  startsAt: flow.startsAt, customerName: "Aisha", customerEmail: "aisha@example.com",
  customerPhone: "+31612345678", customData: {},
}).fingerprint;

function makeModel(initial = {}) {
  const rows = [initial].filter(Boolean);
  return {
    rows,
    async findOne(query) {
      return rows.find((row) => Object.entries(query).every(([key, value]) =>
        key === "status" && value?.$in ? value.$in.includes(row[key]) : String(row[key]) === String(value))) || null;
    },
    async findOneAndUpdate(query, update) {
      const row = await this.findOne(query);
      if (!row) return null;
      Object.assign(row, update.$set);
      return row;
    },
  };
}

function makeReadAdapter() {
  return {
    async listBookableServices() { return [{ id: "service-1", slug: "consultation", name: "Consultation" }]; },
    async listBookableProviders() { return [{ id: "provider-1", slug: "dr-a", displayName: "Dr A" }]; },
    async listAppointmentAvailability() { return [{ startsAt: flow.startsAt, endsAt: "2099-01-15T10:00:00.000Z" }]; },
    async getCustomerForm() { return []; },
  };
}

test("supported appointment booking is revalidated and written once", async () => {
  const model = makeModel({
    companyId: "company-1", chatbotId: "chatbot-1", sessionId: "session-1",
    bookingAttemptId: "attempt-1", idempotencyKey: flow.idempotencyKey, requestFingerprint: bookingFingerprint, status: "draft",
  });
  let writes = 0;
  const events = [];
  const originalInfo = console.info;
  console.info = (value) => events.push(JSON.parse(value));
  let result;
  try {
    result = await executeAiReservationBooking({
      context,
      session: { reservationFlow: flow },
      apiKey: "key",
      model,
      contextResolver: async () => freshContext,
      readAdapter: makeReadAdapter(),
      writeAdapter: {
        async createAppointment(request) {
          writes += 1;
          assert.equal(request.idempotencyKey, flow.idempotencyKey);
          return { bookingId: "booking-1", reference: "BK-1", startsAt: flow.startsAt, endsAt: "2099-01-15T10:00:00.000Z" };
        },
      },
    });
  } finally {
    console.info = originalInfo;
  }
  assert.equal(result.bookingCreated, true);
  assert.equal(writes, 1);
  assert.equal(model.rows[0].status, "completed");
  assert.deepEqual(events.filter(({ event }) => event === "reservation_booking_stage").map(({ stage }) => stage), [
    "execution_started", "stored_attempt_checked", "context_revalidated", "service_revalidated",
    "provider_revalidated", "slot_revalidated", "customer_form_validated", "fingerprint_verified",
    "attempt_confirmed", "attempt_claimed", "write_adapter_start", "write_adapter_success", "attempt_completed",
  ]);
});

test("completed attempts replay the stored booking without another provider write", async () => {
  const stored = { companyId: "company-1", chatbotId: "chatbot-1", sessionId: "session-1", bookingAttemptId: "attempt-1", status: "completed", result: { bookingId: "booking-1", reference: "BK-1" } };
  let writes = 0;
  const result = await executeAiReservationBooking({
    context,
    session: { reservationFlow: flow },
    model: makeModel(stored),
    writeAdapter: { async createAppointment() { writes += 1; } },
  });
  assert.equal(result.replayed, true);
  assert.equal(writes, 0);
});

test("ambiguous provider outcomes become terminal unknown results and are never retried", async () => {
  const model = makeModel({ companyId: "company-1", chatbotId: "chatbot-1", sessionId: "session-1", bookingAttemptId: "attempt-1", idempotencyKey: flow.idempotencyKey, requestFingerprint: bookingFingerprint, status: "draft" });
  let writes = 0;
  await assert.rejects(
    executeAiReservationBooking({
      context,
      session: { reservationFlow: flow },
      model,
      contextResolver: async () => freshContext,
      readAdapter: makeReadAdapter(),
      writeAdapter: {
        async createAppointment() { writes += 1; const error = new Error("network timeout"); error.ambiguous = true; throw error; },
        async findByIdempotencyKey() { return null; },
      },
    }),
    (error) => error.code === "BOOKING_RESULT_UNKNOWN",
  );
  assert.equal(writes, 1);
  assert.equal(model.rows[0].status, "unknown");
  assert.equal(model.rows[0].errorCode, "BOOKING_RESULT_UNKNOWN");
});

test("tenant revalidation rejects a changed business before provider write", async () => {
  const model = makeModel({ companyId: "company-1", chatbotId: "chatbot-1", sessionId: "session-1", bookingAttemptId: "attempt-1", idempotencyKey: flow.idempotencyKey, requestFingerprint: bookingFingerprint, status: "draft" });
  await assert.rejects(
    executeAiReservationBooking({
      context,
      session: { reservationFlow: flow },
      model,
      contextResolver: async () => ({ ...freshContext, reservationBusinessId: 99 }),
      writeAdapter: { async createAppointment() { assert.fail("write must not run"); } },
    }),
    (error) => error.code === "RESERVATION_TENANT_MISMATCH",
  );
});

test("slot revalidation rejects a raced-away time before the provider write", async () => {
  const model = makeModel({ companyId: "company-1", chatbotId: "chatbot-1", sessionId: "session-1", bookingAttemptId: "attempt-1", idempotencyKey: flow.idempotencyKey, requestFingerprint: bookingFingerprint, status: "draft" });
  const readAdapter = { ...makeReadAdapter(), async listAppointmentAvailability() { return []; } };
  await assert.rejects(
    executeAiReservationBooking({
      context,
      session: { reservationFlow: flow },
      model,
      contextResolver: async () => freshContext,
      readAdapter,
      writeAdapter: { async createAppointment() { assert.fail("write must not run"); } },
    }),
    (error) => error.code === "RESERVATION_SLOT_CHANGED",
  );
});

test("slot revalidation accepts the same instant in a different timezone representation", async () => {
  const normalizedBookingFingerprint = fingerprintReservationBookingRequest({
    reservationBusinessSlug: "terrapeak", serviceSlug: "consultation", providerSlug: "dr-a",
    startsAt: "2026-09-22T01:00:00.000Z", customerName: "Aisha", customerEmail: "aisha@example.com",
    customerPhone: "+31612345678", customData: {},
  }).fingerprint;
  const model = makeModel({ companyId: "company-1", chatbotId: "chatbot-1", sessionId: "session-1", bookingAttemptId: "attempt-1", idempotencyKey: flow.idempotencyKey, requestFingerprint: normalizedBookingFingerprint, status: "draft" });
  let writes = 0;
  const readAdapter = {
    ...makeReadAdapter(),
    async listAppointmentAvailability() {
      return [{ startsAt: "2026-09-22T09:00:00+08:00", endsAt: "2026-09-22T10:00:00+08:00" }];
    },
  };
  const result = await executeAiReservationBooking({
    context: { ...context, reservationBusinessSlug: "terrapeak" },
    session: { reservationFlow: { ...flow, startsAt: "2026-09-22T01:00:00.000Z", localDate: "2026-09-22", timezone: "Asia/Kuala_Lumpur" } },
    model,
    contextResolver: async () => ({ ...freshContext, reservationBusinessSlug: "terrapeak" }),
    readAdapter,
    writeAdapter: { async createAppointment() { writes += 1; return { bookingId: "booking-1", reference: "BK-1" }; } },
  });
  assert.equal(result.bookingCreated, true);
  assert.equal(writes, 1);
  assert.equal(model.rows[0].status, "completed");
});

test("slot revalidation rejects a different instant without writing", async () => {
  const model = makeModel({ companyId: "company-1", chatbotId: "chatbot-1", sessionId: "session-1", bookingAttemptId: "attempt-1", idempotencyKey: flow.idempotencyKey, requestFingerprint: bookingFingerprint, status: "draft" });
  let writes = 0;
  await assert.rejects(
    executeAiReservationBooking({
      context,
      session: { reservationFlow: { ...flow, startsAt: "2026-09-22T01:00:00.000Z", localDate: "2026-09-22", timezone: "Asia/Kuala_Lumpur" } },
      model,
      contextResolver: async () => freshContext,
      readAdapter: { ...makeReadAdapter(), async listAppointmentAvailability() { return [{ startsAt: "2026-09-22T01:30:00.000Z" }]; } },
      writeAdapter: { async createAppointment() { writes += 1; } },
    }),
    (error) => error.code === "RESERVATION_SLOT_CHANGED",
  );
  assert.equal(writes, 0);
  assert.equal(model.rows[0].status, "draft");
});

test("invalid slot timestamps fail closed without writing", async () => {
  const model = makeModel({ companyId: "company-1", chatbotId: "chatbot-1", sessionId: "session-1", bookingAttemptId: "attempt-1", idempotencyKey: flow.idempotencyKey, requestFingerprint: bookingFingerprint, status: "draft" });
  let writes = 0;
  await assert.rejects(
    executeAiReservationBooking({
      context,
      session: { reservationFlow: { ...flow, startsAt: "not-a-date" } },
      model,
      contextResolver: async () => freshContext,
      readAdapter: makeReadAdapter(),
      writeAdapter: { async createAppointment() { writes += 1; } },
    }),
    (error) => error.code === "RESERVATION_SLOT_CHANGED",
  );
  assert.equal(writes, 0);
  assert.equal(model.rows[0].status, "draft");
});

test("a changed canonical payload fails closed before claiming or writing", async () => {
  const model = makeModel({ companyId: "company-1", chatbotId: "chatbot-1", sessionId: "session-1", bookingAttemptId: "attempt-1", idempotencyKey: flow.idempotencyKey, requestFingerprint: "different", status: "draft" });
  let writes = 0;
  await assert.rejects(
    executeAiReservationBooking({
      context,
      session: { reservationFlow: flow },
      model,
      contextResolver: async () => freshContext,
      readAdapter: makeReadAdapter(),
      writeAdapter: { async createAppointment() { writes += 1; } },
    }),
    (error) => error.code === "BOOKING_ATTEMPT_CONFLICT",
  );
  assert.equal(writes, 0);
  assert.equal(model.rows[0].status, "draft");
});

test("fingerprint conflict emits the pre-write failure stage", async () => {
  const model = makeModel({ companyId: "company-1", chatbotId: "chatbot-1", sessionId: "session-1", bookingAttemptId: "attempt-1", idempotencyKey: flow.idempotencyKey, requestFingerprint: "different", status: "draft" });
  const events = [];
  const originalInfo = console.info;
  console.info = (value) => events.push(JSON.parse(value));
  try {
    await assert.rejects(
      executeAiReservationBooking({
        context,
        session: { reservationFlow: flow },
        model,
        contextResolver: async () => freshContext,
        readAdapter: makeReadAdapter(),
        writeAdapter: { async createAppointment() { assert.fail("write must not run"); } },
      }),
      (error) => error.code === "BOOKING_ATTEMPT_CONFLICT",
    );
  } finally {
    console.info = originalInfo;
  }
  const failure = events.find(({ event }) => event === "reservation_booking_failed");
  assert.equal(failure.stage, "fingerprint_verified");
  assert.equal(failure.errorCode, "BOOKING_ATTEMPT_CONFLICT");
  assert.equal(failure.ambiguous, false);
});
