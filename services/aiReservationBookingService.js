import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { resolveChatReservationContext, assertReservationSessionBinding } from "./chatReservationContextService.js";
import { resolveChatReservationJourney } from "./chatReservationJourneyService.js";
import { reservationsReadAdapter } from "./reservationReadAdapter.js";
import { reservationWriteAdapter } from "./reservationWriteAdapter.js";
import {
  claimReservationBookingAttempt,
  completeReservationBookingAttempt,
  failReservationBookingAttempt,
  getOrCreateReservationBookingAttempt,
  markReservationBookingAttemptConfirmed,
} from "./reservationBookingAttemptService.js";
import { reconcileReservationBookingAttempt } from "./reservationBookingReconciliationService.js";
import { fingerprintReservationBookingRequest, fingerprintRestaurantBookingRequest, fingerprintScheduledSessionBookingRequest } from "../utils/reservationRequestFingerprint.js";
import ReservationBookingAttempt from "../models/reservationBookingAttempt.js";
import { normalizeCustomerForm, serializeCustomerFormAnswers, serializeScheduledSessionCustomerFormAnswers, validateCustomerForm } from "../utils/aiReservationCustomerForm.js";
import { logAiReservationEvent, measureAiReservationStage } from "../utils/aiReservationLogger.js";
import { sendAiReservationConfirmationEmail } from "./aiReservationConfirmationEmailService.js";

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

const isFutureSession = (value) => {
  const timestamp = new Date(value).valueOf();
  return Number.isFinite(timestamp) && timestamp > Date.now();
};

const executeScheduledSessionBooking = async ({ context, session, flow, model, readAdapter, writeAdapter }) => {
  if (Number(flow.quantity) !== 1) throw fail("RESERVATION_QUANTITY_INVALID", "Only one student can be registered at a time.");
  if (context.configuration?.capabilities?.scheduledSessions !== true) throw fail("RESERVATION_JOURNEY_UNSUPPORTED", "Scheduled-session booking is not available for this Reservations template.");
  if (!context.configuration?.capabilities?.services) throw fail("RESERVATION_JOURNEY_UNSUPPORTED", "Class registration is not available for this Reservations template.");
  if (flow.bookingAttemptId) {
    const existingAttempt = await getStoredAttempt(context, flow.bookingAttemptId, model);
    if (existingAttempt?.status === "completed" && existingAttempt.result) return { bookingCreated: true, replayed: true, result: existingAttempt.result, flowStatus: "completed" };
  }

  const services = await readAdapter.listBookableServices(context);
  const service = services.find((item) => sameId(item.id, flow.serviceId) || item.slug === flow.serviceSlug);
  if (!service || service.isActive === false || service.isPublished === false || !["class", "course"].includes(String(service.bookingType || "").toLowerCase()) || String(service.schedulingMode || "").toLowerCase() !== "scheduled") {
    throw fail("RESERVATION_SERVICE_CHANGED", "The selected class is no longer available.");
  }
  const sessions = await readAdapter.listScheduledSessions(context, { serviceSlug: service.slug });
  const selected = sessions.find((item) => sameId(item.id, flow.scheduledSessionId));
  if (!selected || !sameId(selected.serviceId, service.id) || selected.active === false || selected.isActive === false || selected.published === false || selected.isPublished === false || selected.status === "cancelled" || selected.schedulingMode === "generated" || !isFutureSession(selected.startsAt) || Number(selected.remainingCapacity ?? 0) < 1) {
    throw fail("RESERVATION_SESSION_UNAVAILABLE", "The selected class session is no longer available.");
  }

  const form = normalizeCustomerForm(await readAdapter.getCustomerForm(context));
  const customer = flow.customer || {};
  const customData = flow.customData || {};
  const validationData = { ...customData };
  for (const field of form) {
    const key = field.systemKey === "customer_name" || field.systemKey === "name" ? "name" : field.systemKey === "customer_email" || field.systemKey === "email" ? "email" : field.systemKey === "customer_phone" || field.systemKey === "phone" ? "phone" : null;
    if (key && customer[key] !== undefined) validationData[field.id] = customer[key];
  }
  const formError = validateCustomerForm(form, validationData);
  if (formError || !String(customer.name || "").trim() || !String(customer.email || "").trim() || String(customer.phone || "").replace(/\D/g, "").length < 6) {
    throw fail("RESERVATION_CUSTOMER_FORM_INVALID", formError || "Student and contact details are required.");
  }
  const customDataPayload = serializeScheduledSessionCustomerFormAnswers(form, customData);
  const request = {
    companyId: context.companyId,
    reservationBusinessId: context.reservationBusinessId,
    reservationBusinessSlug: context.reservationBusinessSlug,
    serviceId: service.id,
    serviceSlug: service.slug,
    scheduledSessionId: selected.id,
    quantity: 1,
    startsAt: selected.startsAt,
    customerName: customer.name,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    notes: customer.notes,
    customData: customDataPayload,
  };
  const { fingerprint } = fingerprintScheduledSessionBookingRequest(request);
  if (flow.confirmation?.fingerprint !== fingerprint) throw fail("BOOKING_ATTEMPT_CONFLICT", "The booking request changed and cannot be safely submitted.");
  const bookingAttemptId = flow.bookingAttemptId || randomUUID();
  const ensured = await getOrCreateReservationBookingAttempt({ context, journeyType: "scheduled_session", request: { bookingAttemptId, fingerprint }, model });
  session.reservationFlow = { ...flow, bookingAttemptId: ensured.attempt.bookingAttemptId, idempotencyKey: ensured.idempotencyKey, serviceId: service.id, serviceSlug: service.slug, scheduledSessionId: selected.id, quantity: 1 };
  const activeFlow = session.reservationFlow;
  const currentAttempt = await getStoredAttempt(context, activeFlow.bookingAttemptId, model);
  if (currentAttempt?.status === "completed" && currentAttempt.result) return { bookingCreated: true, replayed: true, result: currentAttempt.result, flowStatus: "completed" };
  if (currentAttempt?.status === "processing" || currentAttempt?.status === "unknown" || (currentAttempt?.status === "failed" && currentAttempt.errorCode === "BOOKING_RESULT_UNKNOWN")) {
    const reconciled = await reconcileReservationBookingAttempt({ attempt: currentAttempt, context, writeAdapter, model, forceLookup: true, expectedIdentity: { businessId: context.reservationBusinessId, idempotencyKey: activeFlow.idempotencyKey, serviceId: service.id, scheduledSessionId: selected.id } });
    if (reconciled.status === "completed") return { bookingCreated: true, replayed: true, recovered: true, result: reconciled.result, flowStatus: "completed" };
    throw fail(reconciled.errorCode || "BOOKING_RESULT_UNKNOWN", "The booking result is still being checked. Please do not submit it again yet.");
  }
  await markReservationBookingAttemptConfirmed({ context, bookingAttemptId: activeFlow.bookingAttemptId, model });
  const claimed = await claimReservationBookingAttempt({ context, bookingAttemptId: activeFlow.bookingAttemptId, model });
  if (!claimed) {
    const existing = await getStoredAttempt(context, activeFlow.bookingAttemptId, model);
    if (existing?.status === "completed" && existing.result) return { bookingCreated: true, replayed: true, result: existing.result, flowStatus: "completed" };
    throw fail("BOOKING_ATTEMPT_IN_PROGRESS", "This booking is already being processed.");
  }
  try {
    if (typeof writeAdapter.createScheduledSessionBooking !== "function") throw fail("RESERVATION_JOURNEY_UNSUPPORTED", "Class registration is not available through the configured write adapter.");
    const result = await writeAdapter.createScheduledSessionBooking({ reservationBusinessSlug: context.reservationBusinessSlug, serviceSlug: service.slug, sessionId: selected.id, customerName: customer.name, customerEmail: customer.email, customerPhone: customer.phone, notes: customer.notes, quantity: 1, customData: customDataPayload, idempotencyKey: activeFlow.idempotencyKey, requestFingerprint: fingerprint });
    const completed = await completeReservationBookingAttempt({ context, bookingAttemptId: activeFlow.bookingAttemptId, result, model });
    if (!completed) throw Object.assign(new Error("The booking attempt could not be finalized."), { ambiguous: true });
    session.reservationFlow = { ...activeFlow, status: "completed", confirmation: { ...activeFlow.confirmation, result } };
    let confirmationEmail = { status: "failed", failureCode: "EMAIL_NOTIFICATION_FAILED" };
    try { confirmationEmail = await sendAiReservationConfirmationEmail({ context, bookingAttemptId: activeFlow.bookingAttemptId, summary: activeFlow.confirmation?.summary || {}, result, model }); } catch {}
    return { bookingCreated: true, replayed: false, result, confirmationEmail, flowStatus: "completed" };
  } catch (error) {
    if (error.ambiguous) {
      const reconciled = await reconcileReservationBookingAttempt({ attempt: await getStoredAttempt(context, activeFlow.bookingAttemptId, model), context, writeAdapter, model, forceLookup: true, expectedIdentity: { businessId: context.reservationBusinessId, idempotencyKey: activeFlow.idempotencyKey, serviceId: service.id, scheduledSessionId: selected.id } }).catch(() => null);
      if (reconciled?.status === "completed") return { bookingCreated: true, replayed: true, recovered: true, result: reconciled.result, flowStatus: "completed" };
      await model.findOneAndUpdate({ companyId: context.companyId, chatbotId: context.chatbotId, sessionId: context.sessionId, idempotencyKey: activeFlow.idempotencyKey, status: "processing" }, { $set: { status: "unknown", errorCode: "BOOKING_RESULT_UNKNOWN" } }, { new: true });
      throw fail("BOOKING_RESULT_UNKNOWN", "The booking result could not be confirmed safely.");
    }
    await failReservationBookingAttempt({ context, bookingAttemptId: activeFlow.bookingAttemptId, errorCode: error.code || "RESERVATIONS_WRITE_FAILED", model });
    throw error;
  }
};

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

const executeRestaurantBooking = async ({ context, session, flow, model, readAdapter, writeAdapter }) => {
  if (context.configuration?.templateKey !== "restaurant" || context.configuration?.capabilities?.guestCount !== true) {
    throw fail("RESERVATION_JOURNEY_UNSUPPORTED", "Automated restaurant booking is not available for this Reservations template.");
  }
  const settings = typeof readAdapter.getRestaurantSettings === "function"
    ? await readAdapter.getRestaurantSettings(context)
    : context.configuration?.restaurantSettings || {};
  const timezone = settings.timezone || flow.timezone;
  if (flow.timezone && settings.timezone && flow.timezone !== settings.timezone) {
    throw fail("RESERVATION_CONFIGURATION_CHANGED", "The restaurant booking settings changed before confirmation.");
  }
  const maxGuests = Number(settings.maxGuests || 0) || null;
  const quantity = Number(flow.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || (maxGuests && quantity > maxGuests)) {
    throw fail("RESERVATION_GUEST_COUNT_INVALID", "Please choose a valid number of guests for this restaurant.");
  }
  if (!flow.localDate || !flow.localTime) throw fail("RESERVATION_SLOT_CHANGED", "The selected restaurant time is incomplete.");
  const slots = await measureAiReservationStage({ stage: "restaurant_slot_revalidation", operation: "list_restaurant_availability", context, flow }, () => readAdapter.listRestaurantAvailability(context, flow.localDate, quantity));
  const selected = slots.find((slot) => String(slot.localTime).slice(0, 5) === String(flow.localTime).slice(0, 5)
    || (flow.startsAt && slot.startsAt && toValidEpochMillis(slot.startsAt) === toValidEpochMillis(flow.startsAt)));
  if (!selected) throw fail("RESERVATION_SLOT_CHANGED", "The selected restaurant time is no longer available.");

  const form = normalizeCustomerForm(await measureAiReservationStage({ stage: "customer_form_revalidation", operation: "get_customer_form", context, flow }, () => readAdapter.getCustomerForm(context)));
  const customer = flow.customer || {};
  const customData = flow.customData || {};
  const validationData = { ...customData };
  for (const field of form) {
    const coreKey = field.systemKey === "customer_name" || field.systemKey === "name" ? "name" : field.systemKey === "customer_email" || field.systemKey === "email" ? "email" : field.systemKey === "customer_phone" || field.systemKey === "phone" ? "phone" : null;
    if (coreKey && customer[coreKey] !== undefined) validationData[field.id] = customer[coreKey];
  }
  const formError = validateCustomerForm(form, validationData);
  if (formError || !String(customer.name || "").trim() || String(customer.phone || "").replace(/\D/g, "").length < 6) {
    throw fail("RESERVATION_CUSTOMER_FORM_INVALID", formError || "Customer name and phone are required.");
  }
  const request = {
    journeyType: "restaurant",
    reservationBusinessId: context.reservationBusinessId,
    reservationBusinessSlug: context.reservationBusinessSlug,
    localDate: flow.localDate,
    localTime: String(selected.localTime).slice(0, 8),
    quantity,
    customerName: customer.name,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    notes: customer.notes,
    customData: serializeCustomerFormAnswers(form, customData),
    idempotencyKey: flow.idempotencyKey,
  };
  const { fingerprint } = fingerprintRestaurantBookingRequest(request);
  const currentAttempt = await getStoredAttempt(context, flow.bookingAttemptId, model);
  if (!currentAttempt?.requestFingerprint || currentAttempt.requestFingerprint !== fingerprint) throw fail("BOOKING_ATTEMPT_CONFLICT", "The booking request changed and cannot be safely submitted.");
  await markReservationBookingAttemptConfirmed({ context, bookingAttemptId: flow.bookingAttemptId, model });
  const claimedAttempt = await claimReservationBookingAttempt({ context, bookingAttemptId: flow.bookingAttemptId, model });
  if (!claimedAttempt) {
    const existing = await getStoredAttempt(context, flow.bookingAttemptId, model);
    if (existing?.status === "completed" && existing.result) return { bookingCreated: true, replayed: true, result: existing.result, flowStatus: "completed" };
    throw fail("BOOKING_ATTEMPT_IN_PROGRESS", "This booking is already being processed.");
  }
  try {
    if (typeof writeAdapter.createRestaurantBooking !== "function") throw fail("RESERVATION_JOURNEY_UNSUPPORTED", "Restaurant booking is not available through the configured write adapter.");
    const result = await writeAdapter.createRestaurantBooking(request);
    const completed = await completeReservationBookingAttempt({ context, bookingAttemptId: flow.bookingAttemptId, result, model });
    if (!completed) throw Object.assign(new Error("The booking attempt could not be finalized."), { ambiguous: true });
    session.reservationFlow = { ...flow, status: "completed", confirmation: { ...flow.confirmation, result } };
    let confirmationEmail = { status: "failed", failureCode: "EMAIL_NOTIFICATION_FAILED" };
    try {
      confirmationEmail = await sendAiReservationConfirmationEmail({ context, bookingAttemptId: flow.bookingAttemptId, summary: flow.confirmation?.summary || {}, result, model });
    } catch (emailError) {
      logAiReservationEvent("reservation_confirmation_email_failed", { companyId: context.companyId, chatbotId: context.chatbotId, businessId: context.reservationBusinessId, attemptId: flow.bookingAttemptId, errorCode: emailError.code || "EMAIL_NOTIFICATION_FAILED" });
    }
    return { bookingCreated: true, replayed: false, result, confirmationEmail, flowStatus: "completed" };
  } catch (error) {
    if (error.ambiguous) {
      await model.findOneAndUpdate({ companyId: context.companyId, chatbotId: context.chatbotId, sessionId: context.sessionId, idempotencyKey: flow.idempotencyKey, status: "processing" }, { $set: { status: "unknown", errorCode: "BOOKING_RESULT_UNKNOWN" } }, { new: true });
      throw fail("BOOKING_RESULT_UNKNOWN", "The booking result could not be confirmed safely.");
    }
    await failReservationBookingAttempt({ context, bookingAttemptId: flow.bookingAttemptId, errorCode: error.code || "RESERVATIONS_WRITE_FAILED", model });
    throw error;
  }
};

  try {
    if (flow?.journeyType === "scheduled_session") {
      return await executeScheduledSessionBooking({ context, session, flow, model, readAdapter, writeAdapter });
    }
    if (!flow?.bookingAttemptId) throw fail("BOOKING_ATTEMPT_ID_REQUIRED", "The booking attempt is incomplete.");
    if (!['appointment', 'restaurant'].includes(flow.journeyType)) throw fail("RESERVATION_JOURNEY_UNSUPPORTED", "This Reservations journey is not supported for automated booking.");
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
  if (flow.journeyType === "restaurant") {
    if (freshContext.configuration.templateKey !== "restaurant" || freshContext.configuration.capabilities.guestCount !== true) {
      throw fail("RESERVATION_JOURNEY_UNSUPPORTED", "Automated restaurant booking is not available for this Reservations template.");
    }
  } else if (!supportedTemplates.has(freshContext.configuration.templateKey) || freshContext.configuration.capabilities.services !== true) {
    throw fail("RESERVATION_JOURNEY_UNSUPPORTED", "Automated booking is not available for this Reservations template.");
  }
  if (String(freshContext.reservationBusinessId) !== String(flow.businessId)) {
    throw fail("RESERVATION_TENANT_MISMATCH", "The Reservations business changed before booking.");
  }

  if (flow.journeyType === "restaurant") {
    return executeRestaurantBooking({ context: freshContext, session, flow, model, readAdapter, writeAdapter });
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
    let confirmationEmail = { status: "failed", failureCode: "EMAIL_NOTIFICATION_FAILED" };
    try {
      confirmationEmail = await sendAiReservationConfirmationEmail({
        context: freshContext,
        bookingAttemptId: flow.bookingAttemptId,
        summary: flow.confirmation?.summary || {},
        result,
        model,
      });
    } catch (emailError) {
      logAiReservationEvent("reservation_confirmation_email_failed", {
        companyId: freshContext.companyId,
        chatbotId: freshContext.chatbotId,
        businessId: freshContext.reservationBusinessId,
        attemptId: flow.bookingAttemptId,
        errorCode: emailError.code || "EMAIL_NOTIFICATION_FAILED",
      });
    }
    logAiReservationEvent("reservation_booking_completed", {
      companyId: freshContext.companyId,
      chatbotId: freshContext.chatbotId,
      businessId: freshContext.reservationBusinessId,
      journeyType: "appointment",
      attemptId: flow.bookingAttemptId,
      bookingId: result.bookingId,
    });
    return { bookingCreated: true, replayed: false, result, confirmationEmail, flowStatus: "completed" };
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
