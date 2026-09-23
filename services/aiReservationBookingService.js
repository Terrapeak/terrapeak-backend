import { performance } from "node:perf_hooks";
import { resolveChatReservationContext, assertReservationSessionBinding } from "./chatReservationContextService.js";
import { resolveChatReservationJourney } from "./chatReservationJourneyService.js";
import { reservationsReadAdapter } from "./reservationReadAdapter.js";
import { reservationWriteAdapter } from "./reservationWriteAdapter.js";
import {
  claimReservationBookingAttempt,
  completeReservationBookingAttempt,
  failReservationBookingAttempt,
  markReservationBookingAttemptConfirmed,
} from "./reservationBookingAttemptService.js";
import { reconcileReservationBookingAttempt } from "./reservationBookingReconciliationService.js";
import { fingerprintReservationBookingRequest } from "../utils/reservationRequestFingerprint.js";
import ReservationBookingAttempt from "../models/reservationBookingAttempt.js";
import { normalizeCustomerForm, serializeCustomerFormAnswers, validateCustomerForm } from "../utils/aiReservationCustomerForm.js";
import { logAiReservationEvent, measureAiReservationStage } from "../utils/aiReservationLogger.js";

const supportedTemplates = new Set(["general", "physiotherapy", "dental", "salon"]);

const sameId = (left, right) => String(left ?? "") === String(right ?? "");

const toValidEpochMillis = (value) => {
  if (value instanceof Date) {
    const milliseconds = value.valueOf();
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const milliseconds = new Date(value).valueOf();
  return Number.isFinite(milliseconds) ? milliseconds : null;
};

const fail = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const getStoredAttempt = async (context, bookingAttemptId, model) => measureAiReservationStage({
  stage: "attempt_read",
  operation: "mongo_booking_attempt_read",
  context,
}, () => model.findOne({
  companyId: context.companyId,
  chatbotId: context.chatbotId,
  sessionId: context.sessionId,
  bookingAttemptId,
}));

export async function executeAiReservationBooking({
  context,
  session,
  flow = session?.reservationFlow,
  apiKey,
  model = ReservationBookingAttempt,
  readAdapter = reservationsReadAdapter,
  writeAdapter = reservationWriteAdapter,
  contextResolver = resolveChatReservationContext,
}) {
  let stage = "execution_started";
  const logStage = (name) => logAiReservationEvent("reservation_booking_stage", {
    companyId: context.companyId,
    chatbotId: context.chatbotId,
    businessId: context.reservationBusinessId,
    attemptId: flow?.bookingAttemptId,
    stage: name,
  });

  try {
    if (!flow?.bookingAttemptId) throw fail("BOOKING_ATTEMPT_ID_REQUIRED", "The booking attempt is incomplete.");
    if (flow.journeyType !== "appointment") throw fail("RESERVATION_JOURNEY_UNSUPPORTED", "This Reservations journey is not supported for automated booking.");
    logStage(stage);

    const storedBeforeConfirmation = await getStoredAttempt(context, flow.bookingAttemptId, model);
    stage = "stored_attempt_checked";
    logStage(stage);
  if (storedBeforeConfirmation?.status === "completed" && storedBeforeConfirmation.result) {
    session.reservationFlow = { ...flow, status: "completed", confirmation: { ...flow.confirmation, result: storedBeforeConfirmation.result } };
    return { bookingCreated: true, replayed: true, result: storedBeforeConfirmation.result, flowStatus: "completed" };
  }
  if (storedBeforeConfirmation?.status === "processing" || storedBeforeConfirmation?.status === "unknown" || (storedBeforeConfirmation?.status === "failed" && storedBeforeConfirmation.errorCode === "BOOKING_RESULT_UNKNOWN")) {
    const reconciled = await reconcileReservationBookingAttempt({
      attempt: storedBeforeConfirmation,
      context,
      writeAdapter,
      model,
    });
    if (reconciled.status === "completed") {
      session.reservationFlow = { ...flow, status: "completed", confirmation: { ...flow.confirmation, result: reconciled.result } };
      return { bookingCreated: true, replayed: true, recovered: true, result: reconciled.result, flowStatus: "completed" };
    }
    throw fail(reconciled.errorCode || "BOOKING_RESULT_UNKNOWN", reconciled.status === "in_progress"
      ? "This booking is still being checked. Please do not submit it again yet."
      : "The booking result is still being checked. Please do not submit it again yet.");
  }
  if (storedBeforeConfirmation?.status === "failed") {
    throw fail(storedBeforeConfirmation.errorCode || "BOOKING_ATTEMPT_FAILED", "This booking attempt cannot be retried safely.");
  }

    const freshContext = await measureAiReservationStage({
      stage: "context_revalidation",
      operation: "resolve_chat_reservation_context",
      context,
      flow,
    }, () => contextResolver({
      apiKey,
      chatbotId: context.chatbotId,
      sessionId: context.sessionId,
      bypassConfigurationCache: true,
    }));
  assertReservationSessionBinding(flow, freshContext);
  stage = "context_revalidated";
  logStage(stage);
  if (!supportedTemplates.has(freshContext.configuration.templateKey) || freshContext.configuration.capabilities.services !== true) {
    throw fail("RESERVATION_JOURNEY_UNSUPPORTED", "Automated booking is not available for this Reservations template.");
  }
  if (String(freshContext.reservationBusinessId) !== String(flow.businessId)) {
    throw fail("RESERVATION_TENANT_MISMATCH", "The Reservations business changed before booking.");
  }

  stage = "service_revalidated";
  const services = await measureAiReservationStage({ stage: "service_revalidation", operation: "list_bookable_services", context: freshContext, flow }, () => readAdapter.listBookableServices(freshContext));
  const service = services.find((item) => sameId(item.id, flow.serviceId) || item.slug === flow.serviceSlug);
  if (!service) throw fail("RESERVATION_SERVICE_CHANGED", "The selected service is no longer available.");
  logStage(stage);

  stage = "provider_revalidated";
  const providers = await measureAiReservationStage({ stage: "provider_revalidation", operation: "list_bookable_providers", context: freshContext, flow }, () => readAdapter.listBookableProviders(freshContext, service));
  const provider = providers.find((item) => sameId(item.id, flow.providerId) || item.slug === flow.providerSlug);
  if (!provider) throw fail("RESERVATION_PROVIDER_CHANGED", "The selected provider is no longer available.");
  logStage(stage);

  stage = "slot_revalidated";
  const slots = await measureAiReservationStage({ stage: "slot_revalidation", operation: "list_appointment_availability", context: freshContext, flow }, () => readAdapter.listAppointmentAvailability(freshContext, {
    serviceId: service.id,
    serviceSlug: service.slug,
    providerId: provider.id,
    providerSlug: provider.slug,
    localDate: flow.localDate,
    timezone: flow.timezone,
  }));
  const selectedStartMs = toValidEpochMillis(flow.startsAt);
  const slot = slots.find((item) => {
    const freshStartMs = toValidEpochMillis(item.startsAt);
    return selectedStartMs !== null && freshStartMs !== null && freshStartMs === selectedStartMs;
  });
  if (!slot) throw fail("RESERVATION_SLOT_CHANGED", "The selected time is no longer available.");
  logStage(stage);

  stage = "customer_form_validated";
  const form = normalizeCustomerForm(await measureAiReservationStage({ stage: "customer_form_revalidation", operation: "get_customer_form", context: freshContext, flow }, () => readAdapter.getCustomerForm(freshContext)));
  const customer = flow.customer || {};
  const customData = flow.customData || {};
  const formError = validateCustomerForm(form, customData);
  if (formError) throw fail("RESERVATION_CUSTOMER_FORM_INVALID", formError);
  if (!String(customer.name || "").trim() || String(customer.phone || "").replace(/\D/g, "").length < 6) {
    throw fail("RESERVATION_CUSTOMER_FORM_INVALID", "Customer name and phone are required.");
  }
  logStage(stage);

  const request = {
    reservationBusinessSlug: freshContext.reservationBusinessSlug,
    serviceSlug: service.slug,
    providerSlug: provider.slug,
    startsAt: slot.startsAt,
    customerName: customer.name,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    notes: customer.notes,
    customData: serializeCustomerFormAnswers(form, customData),
    idempotencyKey: flow.idempotencyKey,
  };
  const fingerprintStartedAt = performance.now();
  const { fingerprint: requestFingerprint } = fingerprintReservationBookingRequest(request);
  logAiReservationEvent("reservation_performance_stage", {
    stage: "fingerprint_calculation",
    operation: "fingerprint_reservation_request",
    durationMs: Math.round(performance.now() - fingerprintStartedAt),
    companyId: freshContext.companyId,
    chatbotId: freshContext.chatbotId,
    businessId: freshContext.reservationBusinessId,
    flowStatus: flow.status,
    attemptId: flow.bookingAttemptId,
    success: true,
  });
  stage = "fingerprint_verified";
  const currentAttempt = await getStoredAttempt(freshContext, flow.bookingAttemptId, model);
  if (!currentAttempt?.requestFingerprint || currentAttempt.requestFingerprint !== requestFingerprint) {
    throw fail("BOOKING_ATTEMPT_CONFLICT", "The booking request changed and cannot be safely submitted.");
  }
  logStage(stage);
  await measureAiReservationStage({ stage: "attempt_confirm", operation: "mongo_booking_attempt_confirm", context: freshContext, flow }, () => markReservationBookingAttemptConfirmed({
    context: freshContext,
    bookingAttemptId: flow.bookingAttemptId,
    model,
  }));
  stage = "attempt_confirmed";
  logStage(stage);
  const claimedAttempt = await measureAiReservationStage({ stage: "attempt_claim", operation: "mongo_booking_attempt_claim", context: freshContext, flow }, () => claimReservationBookingAttempt({
    context: freshContext,
    bookingAttemptId: flow.bookingAttemptId,
    model,
  }));
  if (claimedAttempt) {
    stage = "attempt_claimed";
    logStage(stage);
  }
  if (!claimedAttempt) {
    const existing = await getStoredAttempt(freshContext, flow.bookingAttemptId, model);
    if (existing?.status === "completed" && existing.result) {
      session.reservationFlow = { ...flow, status: "completed", confirmation: { ...flow.confirmation, result: existing.result } };
      return { bookingCreated: true, replayed: true, result: existing.result, flowStatus: "completed" };
    }
    if (existing?.status === "failed") throw fail(existing.errorCode || "BOOKING_ATTEMPT_FAILED", "This booking attempt cannot be retried safely.");
    throw fail("BOOKING_ATTEMPT_IN_PROGRESS", "This booking is already being processed.");
  }

  try {
    stage = "write_adapter_start";
    logStage(stage);
    const result = await measureAiReservationStage({ stage: "write_adapter", operation: "reservation_write_adapter", context: freshContext, flow }, () => writeAdapter.createAppointment(request));
    stage = "write_adapter_success";
    logStage(stage);
    try {
      const completed = await measureAiReservationStage({ stage: "attempt_complete", operation: "mongo_booking_attempt_complete", context: freshContext, flow }, () => completeReservationBookingAttempt({ context: freshContext, bookingAttemptId: flow.bookingAttemptId, result, model }));
      if (!completed) throw new Error("The booking attempt could not be finalized.");
    } catch (error) {
      // The external booking already exists; treat a Mongo finalization error
      // as ambiguous so the idempotent Reservations lookup can recover it.
      error.ambiguous = true;
      throw error;
    }
    stage = "attempt_completed";
    logStage(stage);
    session.reservationFlow = { ...flow, status: "completed", confirmation: { ...flow.confirmation, result } };
    logAiReservationEvent("reservation_booking_completed", {
      companyId: freshContext.companyId,
      chatbotId: freshContext.chatbotId,
      businessId: freshContext.reservationBusinessId,
      journeyType: "appointment",
      attemptId: flow.bookingAttemptId,
      bookingId: result.bookingId,
    });
    return { bookingCreated: true, replayed: false, result, flowStatus: "completed" };
  } catch (error) {
    if (error.ambiguous) {
      let reconciled = null;
      try {
        reconciled = await reconcileReservationBookingAttempt({
          attempt: await getStoredAttempt(freshContext, flow.bookingAttemptId, model),
          context: freshContext,
          writeAdapter,
          model,
          forceLookup: true,
        });
      } catch {
        // The absence of a verified result is intentionally terminal; retrying
        // could create a second booking after an ambiguous provider outcome.
      }
      if (reconciled?.status === "completed") {
        const recovered = reconciled.result;
        session.reservationFlow = { ...flow, status: "completed", confirmation: { ...flow.confirmation, result: recovered } };
        return { bookingCreated: true, replayed: true, recovered: true, result: recovered, flowStatus: "completed" };
      }
      if (reconciled?.status === "conflict") {
        throw fail("IDEMPOTENCY_REQUEST_CONFLICT", "The booking key was already used for a different request.");
      }
    }
    const errorCode = error.ambiguous ? "BOOKING_RESULT_UNKNOWN" : error.code || "RESERVATIONS_WRITE_FAILED";
    if (error.ambiguous) {
      await model.findOneAndUpdate(
        { companyId: freshContext.companyId, chatbotId: freshContext.chatbotId, sessionId: freshContext.sessionId, idempotencyKey: flow.idempotencyKey, status: "processing" },
        { $set: { status: "unknown", errorCode } },
        { new: true },
      );
    } else {
      await failReservationBookingAttempt({ context: freshContext, bookingAttemptId: flow.bookingAttemptId, errorCode, model });
    }
    session.reservationFlow = { ...flow, status: error.ambiguous ? "unknown" : "failed" };
    throw Object.assign(error, { code: errorCode });
  }
  } catch (error) {
    logAiReservationEvent("reservation_booking_failed", {
      companyId: context.companyId,
      chatbotId: context.chatbotId,
      businessId: context.reservationBusinessId,
      journeyType: flow?.journeyType,
      attemptId: flow?.bookingAttemptId,
      stage,
      errorCode: error.code || "RESERVATIONS_WRITE_FAILED",
      ambiguous: Boolean(error.ambiguous),
    });
    throw error;
  }
}
