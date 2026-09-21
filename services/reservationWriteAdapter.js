import { createClient } from "@supabase/supabase-js";
import { fingerprintReservationBookingRequest } from "../utils/reservationRequestFingerprint.js";

export class ReservationBookingWriteError extends Error {
  constructor(code, message, { ambiguous = false, cause } = {}) {
    super(message, { cause });
    this.name = "ReservationBookingWriteError";
    this.code = code;
    this.ambiguous = ambiguous;
  }
}

const getClient = () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ReservationBookingWriteError(
      "RESERVATIONS_WRITE_NOT_CONFIGURED",
      "Reservations booking is not configured.",
    );
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
};

const normalizeResult = (rows) => {
  const result = Array.isArray(rows) ? rows[0] : rows;
  if (!result?.booking_id || !result.reference) {
    throw new ReservationBookingWriteError(
      "RESERVATIONS_WRITE_INVALID_RESULT",
      "Reservations returned an invalid booking result.",
      { ambiguous: true },
    );
  }
  return {
    bookingId: result.booking_id,
    reference: result.reference,
    startsAt: result.starts_at,
    endsAt: result.ends_at,
  };
};

const normalizeLookupResult = (rows) => {
  const result = Array.isArray(rows) ? rows[0] : rows;
  if (!result?.booking_id || !result.reference || !result.request_fingerprint) return null;
  return {
    bookingId: result.booking_id,
    reference: result.reference,
    startsAt: result.starts_at,
    endsAt: result.ends_at,
    status: result.booking_status || null,
    businessId: result.business_id || null,
    requestFingerprint: result.request_fingerprint,
  };
};

const isKnownRejectedWrite = (error) => ["22023", "P0002", "23P01", "42501"].includes(error?.code);
const isIdempotencyConflict = (error) =>
  error?.code === "P0001" && String(error?.message || "").includes("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");

export const createReservationWriteAdapter = ({ clientFactory = getClient } = {}) => ({
  async findByIdempotencyKey({ reservationBusinessSlug, idempotencyKey }) {
    const { data, error } = await clientFactory().rpc("get_public_booking_by_idempotency_key", {
      p_business_slug: reservationBusinessSlug,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw new ReservationBookingWriteError(
      "RESERVATIONS_WRITE_LOOKUP_FAILED",
      "Reservations booking result could not be verified.",
      { ambiguous: true, cause: error },
    );
    return data?.length ? normalizeLookupResult(data) : null;
  },

  async createAppointment({
    reservationBusinessSlug,
    serviceSlug,
    providerSlug,
    startsAt,
    customerName,
    customerEmail,
    customerPhone,
    notes,
    customData,
    idempotencyKey,
  }) {
    if (!idempotencyKey) {
      throw new ReservationBookingWriteError(
        "RESERVATIONS_WRITE_IDEMPOTENCY_REQUIRED",
        "A booking idempotency key is required.",
      );
    }
    const { fingerprint } = fingerprintReservationBookingRequest({
      reservationBusinessSlug,
      serviceSlug,
      providerSlug,
      startsAt,
      customerName,
      customerEmail,
      customerPhone,
      notes,
      customData,
    });
    const { data, error } = await clientFactory().rpc("create_public_booking_idempotent", {
      p_business_slug: reservationBusinessSlug,
      p_service_slug: serviceSlug,
      p_staff_slug: providerSlug,
      p_starts_at: startsAt,
      p_customer_name: customerName,
      p_customer_email: customerEmail || null,
      p_customer_phone: customerPhone || null,
      p_notes: notes || null,
      p_custom_data: customData || {},
      p_idempotency_key: idempotencyKey,
      p_request_fingerprint: fingerprint,
    });
    if (!error) return normalizeResult(data);

    if (isIdempotencyConflict(error)) {
      throw new ReservationBookingWriteError(
        "IDEMPOTENCY_REQUEST_CONFLICT",
        "The booking key was already used for a different request.",
        { cause: error },
      );
    }
    if (isKnownRejectedWrite(error)) {
      throw new ReservationBookingWriteError(
        error.code === "23P01" ? "RESERVATION_SLOT_UNAVAILABLE" : "RESERVATIONS_WRITE_REJECTED",
        error.message || "Reservations rejected the booking.",
        { cause: error },
      );
    }

    throw new ReservationBookingWriteError(
      "RESERVATIONS_WRITE_AMBIGUOUS",
      "The booking result could not be confirmed safely.",
      { ambiguous: true, cause: error },
    );
  },
});

export const reservationWriteAdapter = createReservationWriteAdapter();
