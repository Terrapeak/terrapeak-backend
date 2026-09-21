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
import { logAiReservationEvent } from "../utils/aiReservationLogger.js";

const supportedTemplates = new Set(["general", "physiotherapy", "dental", "salon"]);

const sameId = (left, right) => String(left ?? "") === String(right ?? "");

const fail = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const getStoredAttempt = async (context, bookingAttemptId, model) => model.findOne({
  companyId: context.companyId,
  chatbotId: context.chatbotId,
  sessionId: context.sessionId,
  bookingAttemptId,
});

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
  if (!flow?.bookingAttemptId) throw fail("BOOKING_ATTEMPT_ID_REQUIRED", "The booking attempt is incomplete.");
  if (flow.journeyType !== "appointment") throw fail("RESERVATION_JOURNEY_UNSUPPORTED", "This Reservations journey is not supported for automated booking.");

  const storedBeforeConfirmation = await getStoredAttempt(context, flow.bookingAttemptId, model);
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

  const freshContext = await contextResolver({
    apiKey,
    chatbotId: context.chatbotId,
    sessionId: context.sessionId,
  });
  assertReservationSessionBinding(flow, freshContext);
  if (!supportedTemplates.has(freshContext.configuration.templateKey) || freshContext.configuration.capabilities.services !== true) {
    throw fail("RESERVATION_JOURNEY_UNSUPPORTED", "Automated booking is not available for this Reservations template.");
  }
  if (String(freshContext.reservationBusinessId) !== String(flow.businessId)) {
    throw fail("RESERVATION_TENANT_MISMATCH", "The Reservations business changed before booking.");
  }

  const services = await readAdapter.listBookableServices(freshContext);
  const service = services.find((item) => sameId(item.id, flow.serviceId) || item.slug === flow.serviceSlug);
  if (!service) throw fail("RESERVATION_SERVICE_CHANGED", "The selected service is no longer available.");

  const providers = await readAdapter.listBookableProviders(freshContext, service);
  const provider = providers.find((item) => sameId(item.id, flow.providerId) || item.slug === flow.providerSlug);
  if (!provider) throw fail("RESERVATION_PROVIDER_CHANGED", "The selected provider is no longer available.");

  const slots = await readAdapter.listAppointmentAvailability(freshContext, {
    serviceId: service.id,
    serviceSlug: service.slug,
    providerId: provider.id,
    providerSlug: provider.slug,
    localDate: flow.localDate,
    timezone: flow.timezone,
  });
  const slot = slots.find((item) => String(item.startsAt) === String(flow.startsAt));
  if (!slot) throw fail("RESERVATION_SLOT_CHANGED", "The selected time is no longer available.");

  const form = normalizeCustomerForm(await readAdapter.getCustomerForm(freshContext));
  const customer = flow.customer || {};
  const customData = flow.customData || {};
  const formError = validateCustomerForm(form, customData);
  if (formError) throw fail("RESERVATION_CUSTOMER_FORM_INVALID", formError);
  if (!String(customer.name || "").trim() || String(customer.phone || "").replace(/\D/g, "").length < 6) {
    throw fail("RESERVATION_CUSTOMER_FORM_INVALID", "Customer name and phone are required.");
  }

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
  const { fingerprint: requestFingerprint } = fingerprintReservationBookingRequest(request);
  const currentAttempt = await getStoredAttempt(freshContext, flow.bookingAttemptId, model);
  if (!currentAttempt?.requestFingerprint || currentAttempt.requestFingerprint !== requestFingerprint) {
    throw fail("BOOKING_ATTEMPT_CONFLICT", "The booking request changed and cannot be safely submitted.");
  }
  await markReservationBookingAttemptConfirmed({
    context: freshContext,
    bookingAttemptId: flow.bookingAttemptId,
    model,
  });
  const claimedAttempt = await claimReservationBookingAttempt({
    context: freshContext,
    bookingAttemptId: flow.bookingAttemptId,
    model,
  });
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
    const result = await writeAdapter.createAppointment(request);
    try {
      const completed = await completeReservationBookingAttempt({ context: freshContext, bookingAttemptId: flow.bookingAttemptId, result, model });
      if (!completed) throw new Error("The booking attempt could not be finalized.");
    } catch (error) {
      // The external booking already exists; treat a Mongo finalization error
      // as ambiguous so the idempotent Reservations lookup can recover it.
      error.ambiguous = true;
      throw error;
    }
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
    logAiReservationEvent("reservation_booking_failed", {
      companyId: freshContext.companyId,
      chatbotId: freshContext.chatbotId,
      businessId: freshContext.reservationBusinessId,
      journeyType: "appointment",
      attemptId: flow.bookingAttemptId,
      errorCode,
    });
    throw Object.assign(error, { code: errorCode });
  }
}
