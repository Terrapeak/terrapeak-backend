import { resolveChatReservationJourney } from "./chatReservationJourneyService.js";
import { initializeReservationFlow, prepareReservationConfirmation, confirmReservationFoundation, buildReservationResponse, formatReservationConfirmationSummary, formatReservationSuccessResponse, resetReservationFlowSelections } from "./aiReservationFlowService.js";
import {
  buildCustomerFormPrompt,
  buildCustomerFormValidationMessage,
  customerFormValidationField,
  getCustomerCoreFieldKey,
  isOptionalCustomerFormSkip,
  normalizeStructuredDateInput,
  parseCustomerFormInput,
  validateCustomerFormValue,
} from "../utils/aiReservationCustomerForm.js";
import { normalizeReservationOptionText, resolveAiReservationOption } from "../utils/aiReservationOptionResolver.js";
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

export const formatTimeForDisplay = (value) => String(value || "").replace(/^(\d{1,2}:\d{2}):\d{2}$/, "$1");

const resolveOption = (message, options, labelKey = "name") => resolveAiReservationOption(message, options, {
  labelKey,
  normalize: labelKey === "localTime" ? (value) => normalizeOptionText(formatTimeForDisplay(value)) : normalizeOptionText,
});

const optionSelectionReply = (label, options, message, result) => {
  const candidates = result?.status === "ambiguous" && result.matches?.length ? result.matches : options;
  const rendered = candidates.map((option, index) => `${index + 1}. ${option.name || option.displayName || option.localTime || option.label || option}`).join("\n");
  if (result?.status === "ambiguous") return `I found more than one match for "${String(message).trim()}". Which did you mean?\n\n${rendered}`;
  return `I couldn't match "${String(message).trim()}" to a ${label}. Please choose one of:\n\n${rendered}`;
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

const optionReply = (label, options) => `Please choose a ${label}:\n\n${options.map((option, index) => {
  const value = option.name || option.displayName || option.localTime || `Option ${index + 1}`;
  return `${index + 1}. ${label === "time" ? formatTimeForDisplay(value) : value}`;
}).join("\n")}`;

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
  for (const key of ["startsAt", "localTime", "timezone", "confirmation", "bookingAttemptId", "idempotencyKey"]) delete flow[key];
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

const customerFormFields = (flow) => (Array.isArray(flow.customerFormSnapshot) ? flow.customerFormSnapshot : [])
  .filter((field) => field.active !== false);

const findNextCustomerFormField = (flow) => {
  const fields = customerFormFields(flow);
  const values = flow.customData || {};
  const startIndex = Number(flow.customFieldIndex || 0);
  for (let index = startIndex; index < fields.length; index += 1) {
    const field = fields[index];
    const coreKey = getCustomerCoreFieldKey(field);
    const existingValue = coreKey ? flow.customer?.[coreKey] : values[field.id];
    if (existingValue !== undefined && existingValue !== null && existingValue !== "") {
      const validation = validateCustomerFormValue(customerFormValidationField(field), existingValue);
      if (validation.valid) {
        flow.customData = { ...(flow.customData || {}), [field.id]: existingValue };
        continue;
      }
    }
    flow.customFieldIndex = index;
    flow.currentCustomField = field.id;
    return field;
  }
  flow.currentCustomField = null;
  flow.customFieldIndex = fields.length;
  return null;
};

const clearCustomerFormSelection = (flow) => {
  flow.currentCustomField = null;
  flow.customFieldIndex = null;
};

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
  const prepareConfirmation = async () => {
    if (context.configuration.bookingBehavior?.booking_behavior === "request") {
      flow.status = "completed";
      flow.requestedBooking = true;
      return { handled: true, reply: "I’ve collected the appointment details. Please submit them through the Reservations form so the team can review the request.", reservation: reservationPayload(session, flow, "") };
    }
    const prepared = await measureAiReservationStage({ context, flow, stage: "confirmation_preparation", operation: "prepare_reservation_confirmation" }, () => prepareReservationConfirmation({
      context,
      session,
      flow,
      service: { id: flow.serviceId, slug: flow.serviceSlug, name: flow.serviceName },
      provider: { id: flow.providerId, slug: flow.providerSlug, displayName: flow.providerName },
      slot: { startsAt: flow.startsAt, localTime: flow.localTime, timezone: flow.timezone },
      customer: flow.customer,
      form: flow.customerFormSnapshot,
      model,
    }));
    return { handled: true, reply: formatReservationConfirmationSummary(prepared.summary), reservation: reservationPayload(session, session.reservationFlow, "") };
  };

  const recoverChangedSlot = async () => {
    const slots = await measureAiReservationStage({ context, flow, stage: "availability_read", operation: "list_appointment_availability" }, () => readAdapter.listAppointmentAvailability(context, {
      serviceId: flow.serviceId,
      serviceSlug: flow.serviceSlug,
      providerId: flow.providerId,
      providerSlug: flow.providerSlug,
      localDate: flow.localDate,
      timezone: flow.timezone,
    }));
    const previousTime = formatTimeForDisplay(flow.localTime || flow.confirmation?.summary?.localTime || "That time");
    flow.startsAt = null;
    flow.localTime = null;
    flow.confirmation = {};
    flow.bookingAttemptId = null;
    flow.idempotencyKey = null;
    flow.selectionOptions = slots;
    flow.status = "slot_selection";
    session.reservationFlow = flow;
    const reply = slots.length
      ? `Sorry, ${previousTime} is no longer available.\n\n${optionReply("time", slots)}`
      : `Sorry, ${previousTime} is no longer available. There are no other times available on ${flow.localDate}. Please choose another date.`;
    return { handled: true, reply, reservation: reservationPayload(session, flow, "", "RESERVATION_SLOT_CHANGED") };
  };

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
    if (result.errorCode === "RESERVATION_SLOT_CHANGED") return recoverChangedSlot();
    const reply = result.errorCode === "BOOKING_RESULT_UNKNOWN"
      ? "We’re checking whether your appointment was created. Please don’t submit it again yet."
      : result.errorCode === "BOOKING_IN_PROGRESS"
        ? "We’re still checking whether your appointment was created. Please don’t submit it again yet."
      : result.bookingCreated
      ? formatReservationSuccessResponse(result.summary || flow.confirmation?.summary || {}, { ...(result.result || {}), confirmationEmail: result.confirmationEmail })
      : result.fallbackRequired
        ? "I could not safely complete that appointment in chat. Please use the Reservations form or request a callback."
        : "Please reply **yes** to confirm or **no** to cancel.";
    return { handled: true, reply, reservation: reservationPayload(session, session.reservationFlow, reply, result.errorCode) };
  }

  if (flow.status === "service_selection") {
    const resolved = resolveOption(message, flow.selectionOptions || []);
    const service = resolved.status === "matched" ? resolved.option : matchService(message, flow.selectionOptions || []);
    if (resolved.status === "ambiguous") return { handled: true, reply: optionSelectionReply("service", flow.selectionOptions || [], message, resolved), reservation: reservationPayload(session, flow, "") };
    if (!service) return { handled: true, reply: optionSelectionReply("service", flow.selectionOptions || [], message, resolved), reservation: reservationPayload(session, flow, "") };
    applyService(flow, service);
    const providers = await measureAiReservationStage({ context, flow, stage: "providers_read", operation: "list_bookable_providers" }, () => readAdapter.listBookableProviders(context, service));
    if (!providers.length) return { handled: true, reply: "No providers are available for that service.", reservation: reservationPayload(session, flow, "") };
    flow.status = "provider_selection";
    flow.selectionOptions = providers.map(({ id, slug, displayName }) => ({ id, slug, displayName }));
    return { handled: true, reply: optionReply("provider", providers), reservation: reservationPayload(session, flow, "") };
  }

  if (flow.status === "provider_selection") {
    const resolved = resolveOption(message, flow.selectionOptions || [], "displayName");
    const provider = resolved.status === "matched" ? resolved.option : null;
    if (!provider) return { handled: true, reply: optionSelectionReply("provider", flow.selectionOptions || [], message, resolved), reservation: reservationPayload(session, flow, "") };
    applyProvider(flow, provider);
    flow.status = "date_selection";
    return { handled: true, reply: "What date would you like? Please use YYYY-MM-DD.", reservation: reservationPayload(session, flow, "") };
  }

  if (flow.status === "date_selection") {
    const date = normalizeStructuredDateInput(message);
    if (!date.valid) return { handled: true, reply: date.message, reservation: reservationPayload(session, flow, "") };
    const slots = await measureAiReservationStage({ context, flow, stage: "availability_read", operation: "list_appointment_availability" }, () => readAdapter.listAppointmentAvailability(context, { serviceId: flow.serviceId, serviceSlug: flow.serviceSlug, providerId: flow.providerId, providerSlug: flow.providerSlug, localDate: date.value }));
    if (!slots.length) return { handled: true, reply: "No appointment times are available on that date. Please choose another date.", reservation: reservationPayload(session, flow, "") };
    clearDateDependents(flow);
    flow.localDate = date.value;
    flow.selectionOptions = slots;
    flow.status = "slot_selection";
    return { handled: true, reply: optionReply("time", slots), reservation: reservationPayload(session, flow, "") };
  }

  if (flow.status === "slot_selection") {
    const resolved = resolveOption(message, flow.selectionOptions || [], "localTime");
    const slot = resolved.status === "matched" ? resolved.option : null;
    if (!slot) return { handled: true, reply: optionSelectionReply("time", flow.selectionOptions || [], message, resolved), reservation: reservationPayload(session, flow, "") };
    flow.startsAt = slot.startsAt;
    flow.localTime = slot.localTime || null;
    flow.timezone = slot.timezone;
    if (flow.customerFormSnapshot?.length) {
      const next = findNextCustomerFormField(flow);
      if (!next) return prepareConfirmation();
      flow.status = "customer_form";
      flow.formFieldIndex = 3;
      return { handled: true, reply: buildCustomerFormPrompt(next), reservation: reservationPayload(session, flow, "") };
    }
    flow.status = "customer_form";
    flow.formFieldIndex = 0;
    return { handled: true, reply: "What is your full name?", reservation: reservationPayload(session, flow, "") };
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
      const first = findNextCustomerFormField(flow);
      if (first) {
        flow.formFieldIndex = 3;
        return { handled: true, reply: buildCustomerFormPrompt(first), reservation: reservationPayload(session, flow, "") };
      }
    } else if (flow.currentCustomField) {
      const fields = customerFormFields(flow);
      const field = fields.find((item) => String(item.id) === String(flow.currentCustomField));
      const activeField = field || { id: flow.currentCustomField, label: "this field", type: "text", options: [], required: true };
      const skipRequested = isOptionalCustomerFormSkip(message);
      if (!activeField.required && skipRequested) {
        delete flow.customData[activeField.id];
        flow.customFieldIndex = Number(flow.customFieldIndex || 0) + 1;
        const next = findNextCustomerFormField(flow);
        if (next) return { handled: true, reply: buildCustomerFormPrompt(next), reservation: reservationPayload(session, flow, "") };
        clearCustomerFormSelection(flow);
      } else if (activeField.required && skipRequested) {
        return { handled: true, reply: `This field is required. Please enter ${activeField.label}.`, reservation: reservationPayload(session, flow, "") };
      } else {
        const coreKey = getCustomerCoreFieldKey(activeField);
        const validationField = customerFormValidationField(activeField);
        const parsed = parseCustomerFormInput(validationField, message);
        const validation = parsed.valid
          ? validateCustomerFormValue(validationField, parsed.value)
          : parsed;
        if (!validation.valid) {
          return { handled: true, reply: `${buildCustomerFormValidationMessage(validationField, validation)} Please try again.`, reservation: reservationPayload(session, flow, "") };
        }
        if (coreKey) flow.customer = { ...(flow.customer || {}), [coreKey]: parsed.value };
        flow.customData = { ...(flow.customData || {}), [activeField.id]: parsed.value };
        flow.customFieldIndex = Number(flow.customFieldIndex || 0) + 1;
        const next = findNextCustomerFormField(flow);
        if (next) {
          return { handled: true, reply: buildCustomerFormPrompt(next), reservation: reservationPayload(session, flow, "") };
        }
        clearCustomerFormSelection(flow);
      }
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

    return prepareConfirmation();
  }

  return { handled: false };
}
