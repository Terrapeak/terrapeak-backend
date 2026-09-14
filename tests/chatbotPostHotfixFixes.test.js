import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const {
  buildAppointmentConfirmationReply,
  buildReservationBookingUrl,
  buildReservationCallbackCustomerReply,
  buildReservationCallbackQuestion,
  resetBookingSession,
  resolveCanonicalReservationBookingSlug,
} = await import("../controllers/chatbotController.js");

test("callback customer reply excludes internal staff context", () => {
  const reply = buildReservationCallbackCustomerReply({
    name: "Test Customer",
    preferredTime: "9 PM",
    bookingUrl: "https://reservations.example/book/test",
  });

  assert.match(reply, /sent your callback request/i);
  assert.doesNotMatch(reply, /Conversation context|Recent transcript|raw transcript/i);
  assert.doesNotMatch(reply, /private customer question/i);
});

test("canonical reservation slug wins over stale duplicated values", () => {
  assert.equal(
    resolveCanonicalReservationBookingSlug({
      companySlug: "terrapeak01",
      settingsSlug: "terrapeak01",
      canonicalBusinessSlug: "terrapeak",
    }),
    "terrapeak",
  );
  assert.equal(resolveCanonicalReservationBookingSlug({ canonicalBusinessSlug: "" }), "");
  assert.equal(resolveCanonicalReservationBookingSlug({}), "");
});

test("booking URL requires an approved configured base and canonical slug", () => {
  const previousPublic = process.env.RESERVATION_PUBLIC_BOOKING_BASE_URL;
  const previousApp = process.env.RESERVATION_APP_BASE_URL;
  try {
    process.env.RESERVATION_PUBLIC_BOOKING_BASE_URL = "https://public.example///";
    process.env.RESERVATION_APP_BASE_URL = "https://app.example";
    assert.equal(buildReservationBookingUrl("canonical-slug"), "https://public.example/book/canonical-slug");

    delete process.env.RESERVATION_PUBLIC_BOOKING_BASE_URL;
    assert.equal(buildReservationBookingUrl("canonical-slug"), "https://app.example/book/canonical-slug");

    delete process.env.RESERVATION_APP_BASE_URL;
    assert.equal(buildReservationBookingUrl("canonical-slug"), null);
    assert.equal(buildReservationBookingUrl(""), null);
  } finally {
    if (previousPublic === undefined) delete process.env.RESERVATION_PUBLIC_BOOKING_BASE_URL;
    else process.env.RESERVATION_PUBLIC_BOOKING_BASE_URL = previousPublic;
    if (previousApp === undefined) delete process.env.RESERVATION_APP_BASE_URL;
    else process.env.RESERVATION_APP_BASE_URL = previousApp;
  }
});

test("callback wording follows the configured Reservations template", () => {
  assert.match(buildReservationCallbackQuestion("general"), /service or team member/i);
  assert.match(buildReservationCallbackQuestion("dental"), /treatment or dentist/i);
  assert.match(buildReservationCallbackQuestion("physiotherapy"), /treatment or therapist/i);
  assert.match(buildReservationCallbackQuestion("salon"), /service or stylist/i);
  assert.match(buildReservationCallbackQuestion("learning_centre"), /class or teacher/i);
  assert.match(buildReservationCallbackQuestion("unknown"), /service or team member/i);
});

test("appointment confirmation only mentions cancellation when it occurred", () => {
  const fresh = buildAppointmentConfirmationReply({ meetingLink: "https://meet.example/new" });
  assert.doesNotMatch(fresh, /previous appointment has been cancelled/i);

  const rescheduled = buildAppointmentConfirmationReply({
    meetingLink: "https://meet.example/new",
    previousAppointmentCancelled: true,
  });
  assert.match(rescheduled, /previous appointment has been cancelled/i);
});

test("fresh appointment reset clears stale rescheduling residue", () => {
  const session = {
    isRescheduling: true,
    rescheduleAppointmentId: "old-appointment",
    rescheduleStep: "confirmReschedule",
    rescheduleAppointmentOptions: ["old-appointment"],
  };

  resetBookingSession(session);

  assert.equal(session.isRescheduling, false);
  assert.equal(session.rescheduleAppointmentId, null);
  assert.equal(session.rescheduleStep, null);
  assert.deepEqual(session.rescheduleAppointmentOptions, []);
});

