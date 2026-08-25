import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const {
  generateReservationReference,
  getCanonicalReservationsReadiness,
  normalizeCanonicalRestaurantBooking,
} = await import("../utils/reservationService.js");

test("canonical bookings retain the legacy chatbot display contract", () => {
  const normalized = normalizeCanonicalRestaurantBooking(
    {
      id: "22514ec0-529c-47f7-84b5-185950bde753",
      business_id: 10,
      service_id: 3,
      customer_name: "Aisha",
      customer_phone: "+60 12-345 6789",
      starts_at: "2026-08-20T11:00:00.000Z",
      ends_at: "2026-08-20T12:30:00.000Z",
      quantity: 4,
      status: "confirmed",
      reference: "BK-ABC1234567",
      notes: "Window table",
      custom_data: { Occasion: "Birthday" },
    },
    "Asia/Kuala_Lumpur",
  );

  assert.equal(normalized.reservation_reference, "BK-ABC1234567");
  assert.equal(normalized.phone, "+60 12-345 6789");
  assert.equal(normalized.reservation_date, "2026-08-20");
  assert.equal(normalized.reservation_time, "19:00:00");
  assert.equal(normalized.party_size, 4);
  assert.equal(normalized.special_request, "Window table");
});

test("fallback reference generation is randomized and canonical", async () => {
  const first = await generateReservationReference({});
  const second = await generateReservationReference({});

  assert.match(first, /^BK-[A-F0-9]{10}$/);
  assert.match(second, /^BK-[A-F0-9]{10}$/);
  assert.notEqual(first, second);
});

test("active reservation CRUD no longer references the legacy table", () => {
  const source = readFileSync(
    new URL("../utils/reservationService.js", import.meta.url),
    "utf8",
  );
  const activeCrud = source.slice(
    source.indexOf("export async function checkReservationAvailability"),
    source.indexOf("export async function createOrGetReservationBusiness"),
  );

  assert.doesNotMatch(activeCrud, /\.from\(["']reservations["']\)/);
  assert.match(activeCrud, /\.from\(["']bookings["']\)/);
  assert.match(activeCrud, /create_canonical_restaurant_booking/);
  assert.match(activeCrud, /update_canonical_restaurant_booking/);
});

test("chatbot booking tools fail closed on the canonical Company mapping", () => {
  const source = readFileSync(
    new URL("../controllers/chatbotController.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /RESERVATION_BUSINESS_SLUG/);
  assert.doesNotMatch(source, /dim-sum-dragon/);
  assert.match(source, /reservationCompany\?\.reservationBusinessId/);
  assert.match(source, /CompanyAppInstallation\.findOne/);
  assert.match(
    source,
    /Reservations are not configured for this business\./,
  );
});

test("chatbot sends new Reservations bookings and reschedules to safe handoff paths", () => {
  const source = readFileSync(
    new URL("../controllers/chatbotController.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /buildReservationBookingUrl/);
  assert.match(source, /reservationChoicesReply/);
  assert.match(source, /request callback/);
  assert.match(source, /buildReservationCallbackSummary/);
  assert.match(source, /ReservationStaffRequest/);
  assert.match(source, /Do not create or confirm a new Reservations booking/);
  assert.match(source, /type: "reschedule"/);
  assert.match(source, /Your current booking remains unchanged/);
  assert.match(source, /"appointment",\s*\n\s*"book a table"/);
  assert.doesNotMatch(source, /lowerMsg\.includes\("reschedule appointment"\)\s*\|\|\s*\n\s*lowerMsg\.includes\("reschedule my appointment"\)\s*\|\|\s*\n\s*lowerMsg\.includes\("reschedule meeting"\)/);
  assert.doesNotMatch(source, /lowerMsg\.includes\("appointment"\)\s*\|\|\s*\n\s*lowerMsg\.includes\("meeting"\)/);
  assert.doesNotMatch(source, /createReservation\(/);
  assert.doesNotMatch(source, /updateReservationById\(/);
  assert.match(source, /cancelReservationById\(/);
});

test("Dashboard access fails closed before canonical readiness", async () => {
  assert.deepEqual(await getCanonicalReservationsReadiness(null), {
    ready: false,
    reason: "missing-business-mapping",
  });

  const source = readFileSync(
    new URL("../controllers/companyController.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /getCanonicalReservationsReadiness/);
  assert.match(source, /RESERVATIONS_NOT_CONFIGURED/);
  assert.match(source, /reservationsReadiness\.ready/);
});
