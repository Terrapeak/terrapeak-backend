import { createClient } from "@supabase/supabase-js";
import { fingerprintReservationBookingRequest, fingerprintRestaurantBookingRequest } from "../utils/reservationRequestFingerprint.js";
import { hashOperationalIdentifier, logAiReservationEvent, measureAiReservationStage } from "../utils/aiReservationLogger.js";

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
  const bookingId = result?.booking_id || result?.id;
  if (!bookingId || !result.reference) {
    throw new ReservationBookingWriteError(
      "RESERVATIONS_WRITE_INVALID_RESULT",
      "Reservations returned an invalid booking result.",
      { ambiguous: true },
    );
  }
  return {
    bookingId,
    reference: result.reference,
    startsAt: result.starts_at,
    endsAt: result.ends_at,
  };
};

const normalizeLookupResult = (rows) => {
  const result = Array.isArray(rows) ? rows[0] : rows;
  if (!result?.booking_id || !result.reference || !result.request_fingerprint) return null;
  const normalized = {
    bookingId: result.booking_id,
    reference: result.reference,
    startsAt: result.starts_at,
    endsAt: result.ends_at,
    status: result.booking_status || null,
    businessId: result.business_id || null,
    requestFingerprint: result.request_fingerprint,
  };
  if (Object.prototype.hasOwnProperty.call(result, "service_id")) normalized.serviceId = result.service_id || null;
  if (Object.prototype.hasOwnProperty.call(result, "scheduled_session_id")) normalized.scheduledSessionId = result.scheduled_session_id || null;
  if (Object.prototype.hasOwnProperty.call(result, "idempotency_key")) normalized.idempotencyKey = result.idempotency_key || null;
  return normalized;
};

const isKnownRejectedWrite = (error) => ["22023", "P0002", "23P01", "42501"].includes(error?.code);
const isIdempotencyConflict = (error) =>
  error?.code === "P0001" && String(error?.message || "").includes("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");

export const createReservationWriteAdapter = ({ clientFactory = getClient } = {}) => ({
  async findByIdempotencyKey({ reservationBusinessSlug, idempotencyKey }) {
    const { data, error } = await measureAiReservationStage({ stage: "supabase_lookup_rpc", operation: "get_public_booking_by_idempotency_key", context: { reservationBusinessId: null, reservationBusinessSlug } }, () => clientFactory().rpc("get_public_booking_by_idempotency_key", {
      p_business_slug: reservationBusinessSlug,
      p_idempotency_key: idempotencyKey,
    }));
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
    const rpcMetadata = {
      businessSlug: reservationBusinessSlug,
      serviceSlug,
      providerSlug,
      idempotencyKeyHash: hashOperationalIdentifier(idempotencyKey),
      requestFingerprint: fingerprint,
    };
    logAiReservationEvent("reservation_write_rpc_start", rpcMetadata);

    let data;
    let error;
    try {
      ({ data, error } = await measureAiReservationStage({ stage: "supabase_write_rpc", operation: "create_public_booking_idempotent", context: { reservationBusinessSlug } }, () => clientFactory().rpc("create_public_booking_idempotent", {
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
      })));
    } catch (rpcError) {
      logAiReservationEvent("reservation_write_rpc_failed", {
        ...rpcMetadata,
        supabaseErrorCode: rpcError?.code,
        mappedErrorCode: rpcError?.code || "RESERVATIONS_WRITE_AMBIGUOUS",
        ambiguous: Boolean(rpcError?.ambiguous ?? true),
      });
      throw rpcError;
    }
    if (!error) {
      const result = normalizeResult(data);
      logAiReservationEvent("reservation_write_rpc_success", {
        businessSlug: reservationBusinessSlug,
        bookingId: result.bookingId,
        reference: result.reference,
      });
      return result;
    }

    if (isIdempotencyConflict(error)) {
      logAiReservationEvent("reservation_write_rpc_failed", {
        ...rpcMetadata,
        supabaseErrorCode: error.code,
        mappedErrorCode: "IDEMPOTENCY_REQUEST_CONFLICT",
        ambiguous: false,
      });
      throw new ReservationBookingWriteError(
        "IDEMPOTENCY_REQUEST_CONFLICT",
        "The booking key was already used for a different request.",
        { cause: error },
      );
    }
    if (isKnownRejectedWrite(error)) {
      const mappedErrorCode = error.code === "23P01" ? "RESERVATION_SLOT_UNAVAILABLE" : "RESERVATIONS_WRITE_REJECTED";
      logAiReservationEvent("reservation_write_rpc_failed", {
        ...rpcMetadata,
        supabaseErrorCode: error.code,
        mappedErrorCode,
        ambiguous: false,
      });
      throw new ReservationBookingWriteError(
        mappedErrorCode,
        error.message || "Reservations rejected the booking.",
        { cause: error },
      );
    }

    logAiReservationEvent("reservation_write_rpc_failed", {
      ...rpcMetadata,
      supabaseErrorCode: error.code,
      mappedErrorCode: "RESERVATIONS_WRITE_AMBIGUOUS",
      ambiguous: true,
    });
    throw new ReservationBookingWriteError(
      "RESERVATIONS_WRITE_AMBIGUOUS",
      "The booking result could not be confirmed safely.",
      { ambiguous: true, cause: error },
    );
  },

  async createRestaurantBooking({
    reservationBusinessId,
    reservationBusinessSlug,
    localDate,
    localTime,
    quantity,
    customerName,
    customerEmail,
    customerPhone,
    notes,
    customData,
    idempotencyKey,
  }) {
    if (!idempotencyKey) throw new ReservationBookingWriteError(
      "RESERVATIONS_WRITE_IDEMPOTENCY_REQUIRED",
      "A booking idempotency key is required.",
    );
    const { fingerprint } = fingerprintRestaurantBookingRequest({
      reservationBusinessId,
      reservationBusinessSlug,
      localDate,
      localTime,
      quantity,
      customerName,
      customerEmail,
      customerPhone,
      notes,
      customData,
    });
    const metadata = {
      businessId: reservationBusinessId,
      businessSlug: reservationBusinessSlug,
      idempotencyKeyHash: hashOperationalIdentifier(idempotencyKey),
      requestFingerprint: fingerprint,
      journeyType: "restaurant",
    };
    logAiReservationEvent("reservation_write_rpc_start", metadata);
    let data;
    let error;
    try {
      ({ data, error } = await measureAiReservationStage({ stage: "supabase_write_rpc", operation: "create_canonical_restaurant_booking", context: { reservationBusinessId, reservationBusinessSlug } }, () => clientFactory().rpc("create_canonical_restaurant_booking", {
        p_business_id: Number(reservationBusinessId),
        p_customer_name: customerName,
        p_customer_phone: customerPhone,
        p_local_date: localDate,
        p_local_time: localTime,
        p_quantity: Number(quantity),
        p_notes: notes || null,
        p_custom_data: customData || {},
        p_customer_email: customerEmail || null,
      })));
    } catch (rpcError) {
      logAiReservationEvent("reservation_write_rpc_failed", {
        ...metadata,
        supabaseErrorCode: rpcError?.code,
        mappedErrorCode: rpcError?.code || "RESERVATIONS_WRITE_AMBIGUOUS",
        ambiguous: Boolean(rpcError?.ambiguous ?? true),
      });
      throw rpcError;
    }
    if (!error) {
      const result = normalizeResult(data);
      logAiReservationEvent("reservation_write_rpc_success", { businessId: reservationBusinessId, bookingId: result.bookingId, reference: result.reference, journeyType: "restaurant" });
      return result;
    }
    if (isKnownRejectedWrite(error)) {
      const mappedErrorCode = error.code === "23P01" ? "RESERVATION_SLOT_UNAVAILABLE" : "RESERVATIONS_WRITE_REJECTED";
      throw new ReservationBookingWriteError(mappedErrorCode, error.message || "Reservations rejected the booking.", { cause: error });
    }
    throw new ReservationBookingWriteError("RESERVATIONS_WRITE_AMBIGUOUS", "The booking result could not be confirmed safely.", { ambiguous: true, cause: error });
  },

  async createScheduledSessionBooking({
    reservationBusinessSlug,
    serviceSlug,
    sessionId,
    customerName,
    customerEmail,
    customerPhone,
    notes,
    quantity,
    customData,
    idempotencyKey,
    requestFingerprint,
  }) {
    if (!idempotencyKey) throw new ReservationBookingWriteError("RESERVATIONS_WRITE_IDEMPOTENCY_REQUIRED", "A booking idempotency key is required.");
    if (Number(quantity) !== 1) throw new ReservationBookingWriteError("RESERVATION_QUANTITY_INVALID", "Only one student can be registered at a time.");
    if (!requestFingerprint) throw new ReservationBookingWriteError("RESERVATIONS_WRITE_FINGERPRINT_REQUIRED", "A booking request fingerprint is required.");
    const args = {
      p_business_slug: reservationBusinessSlug,
      p_service_slug: serviceSlug,
      p_session_id: sessionId,
      p_customer_name: customerName,
      p_customer_email: customerEmail || null,
      p_customer_phone: customerPhone || null,
      p_notes: notes || null,
      p_quantity: 1,
      p_custom_data: customData || {},
      p_idempotency_key: idempotencyKey,
      p_request_fingerprint: requestFingerprint,
    };
    let data;
    let error;
    try {
      ({ data, error } = await measureAiReservationStage({ stage: "supabase_write_rpc", operation: "create_public_session_booking_idempotent", context: { reservationBusinessSlug, sessionId } }, () => clientFactory().rpc("create_public_session_booking_idempotent", args)));
    } catch (rpcError) {
      throw rpcError;
    }
    if (!error) return normalizeResult(data);
    if (isIdempotencyConflict(error)) throw new ReservationBookingWriteError("IDEMPOTENCY_REQUEST_CONFLICT", "The booking key was already used for a different request.", { cause: error });
    if (isKnownRejectedWrite(error)) {
      const code = error.code === "23P01" ? "RESERVATION_CAPACITY_UNAVAILABLE" : error.code === "P0002" ? "RESERVATION_SESSION_UNAVAILABLE" : error.code === "22023" ? "RESERVATION_CUSTOMER_FORM_INVALID" : "RESERVATIONS_WRITE_REJECTED";
      throw new ReservationBookingWriteError(code, error.message || "Reservations rejected the booking.", { cause: error });
    }
    throw new ReservationBookingWriteError("RESERVATIONS_WRITE_AMBIGUOUS", "The booking result could not be confirmed safely.", { ambiguous: true, cause: error });
  },
});

export const reservationWriteAdapter = createReservationWriteAdapter();
