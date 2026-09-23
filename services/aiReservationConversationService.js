import { resolveChatReservationJourney } from "./chatReservationJourneyService.js";
import { initializeReservationFlow, prepareReservationConfirmation, confirmReservationFoundation, buildReservationResponse, resetReservationFlowSelections } from "./aiReservationFlowService.js";
import { parseCustomerFormInput, validateCustomerFormValue } from "../utils/aiReservationCustomerForm.js";
import { measureAiReservationStage } from "../utils/aiReservationLogger.js";

const supportedTemplates = new Set(["general", "physiotherapy", "dental", "salon"]);
const naturalServiceWords = new Set([
  "appointment", "consultation", "cleaning", "follow-up", "followup", "therapy", "physio",
  "dental", "dentist", "doctor", "haircut", "massage", "treatment", "session", "class",
]);

const normalizeOptionText = (value) => String(value || "")
  .toLowerCase()
  .replace(/[’']/g, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const stripBookingWrapper = (message) => normalizeOptionText(message)
  .replace(/^(?:i want to|i would like to|id like to|can i|could i|please|i need to|i need|id like)\s+/, "")
  .replace(/^(?:make|schedule|book|reserve)\s+(?:a|an|the)?\s*/, "")
  .replace(/^(?:a|an|the)\s+/, "")
  .replace(/\s+(?:appointment|booking|reservation)$/i, "")
  .trim();

export const isGenericBookingIntent = (message = "") => {
  const normalized = normalizeOptionText(message);
  if (!normalized) return false;
  if (/^(?:what|how|why|do you|does your|tell me|explain)\b/.test(normalized)) return false;
  if (/\b(?:booked|reserved|scheduled)\b/.test(normalized)) return false;
  if (/\b(?:booking reference|reservation system|appointment scheduling|support bookings?)\b/.test(normalized)) return false;
  return Boolean(
    /\b(?:i want to|i would like to|id like to|can i|could i|please)\s+(?:make\s+)?(?:a\s+)?(?:booking|reservation|appointment|schedule|book)\b/.test(normalized) ||
    /\b(?:i need|id like)\s+(?:(?:an?|the)\s+)?(?:appointment|consultation|cleaning|follow[- ]?up|therapy|treatment|session)\b/.test(normalized) ||
    /\b(?:book|schedule|reserve)\s+(?:me\s+in|an?\s+appointment|a\s+(?:time|booking|reservation)|appointment|reservation|booking)\b/.test(normalized) ||
    /\bmake\s+(?:a\s+)?(?:booking|reservation)\b/.test(normalized) ||
    /^\s*(?:book|schedule|reserve)\s+\S+/.test(normalized)
  );
};

export const isNaturalServiceBookingIntent = (message = "") => {
  if (isGenericBookingIntent(message)) return true;
  const normalized = normalizeOptionText(message);
  if (!/^i\s+need\s+(?:a|an|the)\s+/.test(normalized)) return false;
  return normalized.split(" ").some((word) => naturalServiceWords.has(word));
};

export const isCancelMessage = (message = "") => {
  const normalized = normalizeOptionText(message);
  return new Set([
    "cancel", "stop", "exit", "quit", "never mind", "nevermind", "forget it",
    "cancel this", "cancel booking", "i do not want to book anymore", "i dont want to book anymore",
  ]).has(normalized);
};

const isRestartMessage = (message = "") => /^(?:start over|restart|start again|restart booking)$/i.test(normalizeOptionText(message));

const selectOption = (message, options, labelKey = "name") => {
  const value = String(message || "").trim();
  const normalizedValue = normalizeOptionText(value);
  const exact = options.find((option) => [
    option.slug,
    option[labelKey],
    option.name,
    option.displayName,
    option.localTime,
    option.id,
  ].some((candidate) => normalizeOptionText(candidate) === normalizedValue));
  if (exact) return exact;
  if (/^\d+$/.test(value)) {
    const numeric = Number.parseInt(value, 10);
    if (numeric >= 1 && numeric <= options.length) return options[numeric - 1];
  }
  return null;
};

const matchService = (message, services) => {
  const candidates = [normalizeOptionText(message), stripBookingWrapper(message)].filter(Boolean);
  const exact = services.filter((service) => candidates.some((candidate) => [service.name, service.slug]
    .some((value) => normalizeOptionText(value) === candidate)));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const query = stripBookingWrapper(message).split(" ").filter(Boolean);
  if (!query.length) return null;
  const natural = services.filter((service) => {
    const words = new Set(normalizeOptionText(service.name).split(" "));
    return query.every((word) => words.has(word));
  });
  return natural.length === 1 ? natural[0] : null;
};

const optionReply = (label, options) => `Please choose a ${label}:\n\n${options.map((option, index) => `${index + 1}. ${option.name || option.displayName || option.localTime || `Option ${index + 1}`}`).join("\n")}`;

const clearServiceDependents = (flow) => {
  for (const key of ["providerId", "providerSlug", "providerName", "localDate", "startsAt", "timezone", "formFieldIndex", "currentCustomField", "customFieldIndex", "customerFormSnapshot", "customer", "customData", "confirmation", "bookingAttemptId", "idempotencyKey"]) delete flow[key];
  flow.customer = {};
  flow.customData = {};
  flow.customerFormSnapshot = [];
  flow.confirmation = {};
  flow.selectionOptions = [];
};

const clearProviderDependents = (flow) => {
  for (const key of ["localDate", "startsAt", "timezone", "formFieldIndex", "currentCustomField", "customFieldIndex", "customerFormSnapshot", "customer", "customData", "confirmation", "bookingAttemptId", "idempotencyKey"]) delete flow[key];
  flow.customer = {};
  flow.customData = {};
  flow.customerFormSnapshot = [];
  flow.confirmation = {};
};

const clearDateDependents = (flow) => {
  for (const key of ["startsAt", "timezone", "confirmation", "bookingAttemptId", "idempotencyKey"]) delete flow[key];
  flow.confirmation = {};
};

const applyService = (flow, service) => {
  clearServiceDependents(flow);
  flow.serviceId = service.id;
  flow.serviceSlug = service.slug;
  flow.serviceName = service.name;
};

const applyProvider = (flow, provider) => {
  clearProviderDependents(flow);
  flow.providerId = provider.id;
  flow.providerSlug = provider.slug;
  flow.providerName = provider.displayName;
};

const terminalStatuses = new Set(["completed", "cancelled", "failed", "unknown"]);

const reservationPayload = (session, flow, reply, errorCode = null) => buildReservationResponse({
  reply,
  flowStatus: flow?.status || "idle",
  journeyType: flow?.journeyType || null,
  step: flow?.status || null,
  summary: flow?.confirmation?.summary || null,
  confirmationRequired: flow?.status === "awaiting_confirmation",
  errorCode,
}).reservation;

export async function handleAiReservationConversation({
  context,
  session,
  message,
  apiKey,
  model,
  readAdapter,
  writeAdapter,
  contextResolver,
} = {}) {
  const current = session.reservationFlow;
  const startRequested = isGenericBookingIntent(message) || isNaturalServiceBookingIntent(message) || isRestartMessage(message);
  const startFlow = async () => {
    const journey = await measureAiReservationStage({ context, stage: "journey_resolution", operation: "resolve_reservation_journey" }, async () => resolveChatReservationJourney({ configuration: context.configuration }));
    if (journey.journeyType !== "appointment" || !supportedTemplates.has(journey.templateKey)) return { handled: false };
    const flow = initializeReservationFlow({ context, session, journeyType: "appointment" });
    const services = await measureAiReservationStage({ context, flow, stage: "services_read", operation: "list_bookable_services" }, () => readAdapter.listBookableServices(context));
    if (!services.length) return { handled: true, reply: "No appointment services are available right now.", reservation: reservationPayload(session, flow, "") };
    flow.selectionOptions = services.map(({ id, slug, name }) => ({ id, slug, name }));
    const service = matchService(message, services);
    if (service) {
      applyService(flow, service);
      const providers = await measureAiReservationStage({ context, flow, stage: "providers_read", operation: "list_bookable_providers" }, () => readAdapter.listBookableProviders(context, service));
      if (!providers.length) return { handled: true, reply: "No providers are available for that service.", reservation: reservationPayload(session, flow, "") };
      flow.status = "provider_selection";
      flow.selectionOptions = providers.map(({ id, slug, displayName }) => ({ id, slug, displayName }));
      session.reservationFlow = flow;
      return { handled: true, reply: optionReply("provider", providers), reservation: reservationPayload(session, flow, "") };
    }
    session.reservationFlow = flow;
    return { handled: true, reply: optionReply("service", services), reservation: reservationPayload(session, flow, "") };
  };

  if (!current?.status || current.status === "idle" || (terminalStatuses.has(current.status) && startRequested)) {
    return startFlow();
  }
  if (terminalStatuses.has(current.status)) return { handled: false };
  if (startRequested && /\b(?:again|another|instead|actually|rather)\b/i.test(String(message))) {
    return startFlow();
  }

  const flow = current;
  if (isRestartMessage(message)) return startFlow();
  if (isCancelMessage(message)) {
    session.reservationFlow = resetReservationFlowSelections(flow);
    return { handled: true, reply: "Okay, I cancelled the appointment booking.", reservation: reservationPayload(session, session.reservationFlow, "") };
  }

  if (flow.status === "awaiting_confirmation") {
    const result = await measureAiReservationStage({ context, flow, stage: "confirmation_execution", operation: "confirm_reservation_foundation" }, () => confirmReservationFoundation({
      context,
      session,
      message,
      apiKey,
      model,
      readAdapter,
      writeAdapter,
      contextResolver,
    }));
    const reply = result.errorCode === "BOOKING_RESULT_UNKNOWN"
      ? "We’re checking whether your appointment was created. Please don’t submit it again yet."
      : result.errorCode === "BOOKING_IN_PROGRESS"
        ? "We’re still checking whether your appointment was created. Please don’t submit it again yet."
        : result.bookingCreated
      ? `Your appointment is confirmed. Reference: ${result.result.reference}.`
      : result.fallbackRequired
        ? "I could not safely complete that appointment in chat. Please use the Reservations form or request a callback."
        : "Please reply **yes** to confirm or **no** to cancel.";
    return { handled: true, reply, reservation: reservationPayload(session, session.reservationFlow, reply, result.errorCode) };
  }

  if (flow.status === "service_selection") {
    const service = selectOption(message, flow.selectionOptions || []) || matchService(message, flow.selectionOptions || []);
    if (!service) return { handled: true, reply: optionReply("service", flow.selectionOptions || []), reservation: reservationPayload(session, flow, "") };
    applyService(flow, service);
    const providers = await measureAiReservationStage({ context, flow, stage: "providers_read", operation: "list_bookable_providers" }, () => readAdapter.listBookableProviders(context, service));
    if (!providers.length) return { handled: true, reply: "No providers are available for that service.", reservation: reservationPayload(session, flow, "") };
    flow.status = "provider_selection";
    flow.selectionOptions = providers.map(({ id, slug, displayName }) => ({ id, slug, displayName }));
    return { handled: true, reply: optionReply("provider", providers), reservation: reservationPayload(session, flow, "") };
  }

  if (flow.status === "provider_selection") {
    const provider = selectOption(message, flow.selectionOptions || [], "displayName");
    if (!provider) return { handled: true, reply: optionReply("provider", flow.selectionOptions || []), reservation: reservationPayload(session, flow, "") };
    applyProvider(flow, provider);
    flow.status = "date_selection";
    return { handled: true, reply: "What date would you like? Please use YYYY-MM-DD.", reservation: reservationPayload(session, flow, "") };
  }

  if (flow.status === "date_selection") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(message).trim())) return { handled: true, reply: "Please provide a valid date in YYYY-MM-DD format.", reservation: reservationPayload(session, flow, "") };
    const slots = await measureAiReservationStage({ context, flow, stage: "availability_read", operation: "list_appointment_availability" }, () => readAdapter.listAppointmentAvailability(context, { serviceId: flow.serviceId, serviceSlug: flow.serviceSlug, providerId: flow.providerId, providerSlug: flow.providerSlug, localDate: String(message).trim() }));
    if (!slots.length) return { handled: true, reply: "No appointment times are available on that date. Please choose another date.", reservation: reservationPayload(session, flow, "") };
    clearDateDependents(flow);
    flow.localDate = String(message).trim();
    flow.selectionOptions = slots;
    flow.status = "slot_selection";
    return { handled: true, reply: optionReply("time", slots), reservation: reservationPayload(session, flow, "") };
  }

  if (flow.status === "slot_selection") {
    const slot = selectOption(message, flow.selectionOptions || [], "localTime");
    if (!slot) return { handled: true, reply: optionReply("time", flow.selectionOptions || []), reservation: reservationPayload(session, flow, "") };
    flow.startsAt = slot.startsAt;
    flow.timezone = slot.timezone;
    flow.status = "customer_form";
    flow.formFieldIndex = 0;
    return { handled: true, reply: "What is the customer’s full name?", reservation: reservationPayload(session, flow, "") };
  }

  if (flow.status === "customer_form") {
    const index = Number(flow.formFieldIndex || 0);
    if (index === 0) {
      flow.customer = { ...(flow.customer || {}), name: String(message).trim() };
      flow.formFieldIndex = 1;
      return { handled: true, reply: "What email address should we use?", reservation: reservationPayload(session, flow, "") };
    }
    if (index === 1) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(message).trim())) return { handled: true, reply: "Please provide a valid email address.", reservation: reservationPayload(session, flow, "") };
      flow.customer = { ...(flow.customer || {}), email: String(message).trim() };
      flow.formFieldIndex = 2;
      return { handled: true, reply: "What phone number should we use?", reservation: reservationPayload(session, flow, "") };
    }
    if (index === 2) {
      if (String(message).replace(/\D/g, "").length < 6) return { handled: true, reply: "Please provide a valid phone number.", reservation: reservationPayload(session, flow, "") };
      flow.customer = { ...(flow.customer || {}), phone: String(message).trim() };
      const form = await measureAiReservationStage({ context, flow, stage: "customer_form_read", operation: "get_customer_form" }, () => readAdapter.getCustomerForm(context));
      flow.customerFormSnapshot = form;
      const first = form.find((field) => field.required || field.active);
      if (first) {
        flow.formFieldIndex = 3;
        flow.currentCustomField = first.id;
        flow.customFieldIndex = 0;
        return { handled: true, reply: first.label, reservation: reservationPayload(session, flow, "") };
      }
    } else if (flow.currentCustomField) {
      const fields = Array.isArray(flow.customerFormSnapshot) ? flow.customerFormSnapshot : [];
      const field = fields.find((item) => String(item.id) === String(flow.currentCustomField));
      const activeField = field || { id: flow.currentCustomField, label: flow.currentCustomField, type: "text", options: [] };
      const parsed = parseCustomerFormInput(activeField, message);
      const validation = parsed.valid
        ? validateCustomerFormValue(activeField, parsed.value)
        : parsed;
      if (!validation.valid) {
        return { handled: true, reply: `${validation.message} Please try again.`, reservation: reservationPayload(session, flow, "") };
      }
      flow.customData = { ...(flow.customData || {}), [flow.currentCustomField]: parsed.value };
      const next = fields.slice(Number(flow.customFieldIndex || 0) + 1).find((field) => field.active);
      if (next) {
        flow.customFieldIndex = fields.indexOf(next);
        flow.currentCustomField = next.id;
        return { handled: true, reply: next.label, reservation: reservationPayload(session, flow, "") };
      }
      flow.currentCustomField = null;
    }

    if (context.configuration.bookingBehavior?.booking_behavior === "request") {
      flow.status = "completed";
      flow.requestedBooking = true;
      return {
        handled: true,
        reply: "I’ve collected the appointment details. Please submit them through the Reservations form so the team can review the request.",
        reservation: reservationPayload(session, flow, ""),
      };
    }

    const summary = await measureAiReservationStage({ context, flow, stage: "confirmation_preparation", operation: "prepare_reservation_confirmation" }, () => prepareReservationConfirmation({
      context,
      session,
      flow,
      service: { id: flow.serviceId, slug: flow.serviceSlug, name: flow.serviceName },
      provider: { id: flow.providerId, slug: flow.providerSlug, displayName: flow.providerName },
      slot: { startsAt: flow.startsAt, timezone: flow.timezone },
      customer: flow.customer,
      form: flow.customerFormSnapshot,
      model,
    }));
    return { handled: true, reply: `${summary.summary.serviceName || "Your appointment"} is ready. Reply **yes** to confirm or **no** to cancel.`, reservation: reservationPayload(session, session.reservationFlow, "") };
  }

  return { handled: false };
}
