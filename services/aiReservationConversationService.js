import { resolveChatReservationJourney } from "./chatReservationJourneyService.js";
import { initializeReservationFlow, prepareReservationConfirmation, prepareScheduledSessionConfirmation, confirmReservationFoundation, buildReservationResponse, formatReservationConfirmationSummary, formatReservationSuccessResponse, resetReservationFlowSelections } from "./aiReservationFlowService.js";
import {
  buildCustomerFormPrompt,
  buildCustomerFormValidationMessage,
  customerFormValidationField,
  getCustomerCoreFieldKey,
  isOptionalCustomerFormSkip,
  parseCustomerFormInput,
  validateCustomerFormValue,
} from "../utils/aiReservationCustomerForm.js";
import { normalizeReservationOptionText, resolveAiReservationOption } from "../utils/aiReservationOptionResolver.js";
import { measureAiReservationStage } from "../utils/aiReservationLogger.js";
import { parseNaturalReservationDate } from "../utils/aiReservationDateParser.js";

const supportedTemplates = new Set(["general", "physiotherapy", "dental", "salon"]);
const naturalServiceWords = new Set([
  "appointment", "consultation", "cleaning", "follow-up", "followup", "therapy", "physio",
  "dental", "dentist", "doctor", "haircut", "massage", "treatment", "session", "class", "service", "test",
]);

const classInformationPattern = /\b(?:class(?:es)?|session(?:s)?|course(?:s)?|programme(?:s)?|program(?:s)?|register|enrol|enroll)\b/i;
const packageInformationPattern = /\bpackage(?:s)?\b/i;
const restaurantReservationPattern = /\b(?:table|restaurant|guest(?:s)?|party|people)\b/i;
const reservationActionPattern = /\b(?:book|booking|reserve|reservation|register|enrol|enroll|join|available|offer|options?|have)\b/i;
const restaurantActionPattern = /\b(?:book|booking|reserve|reservation|table|restaurant|guest(?:s)?|party)\b/i;
const meetingOrCallbackPattern = /\b(?:meeting|callback|call\s+me|consultation)\b/i;
const restaurantNumberWords = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 });

export const isClassInformationIntent = (message = "") => {
  const normalized = normalizeOptionText(message);
  if (!classInformationPattern.test(normalized) || !reservationActionPattern.test(normalized)) return false;
  return !isClassBookingIntent(normalized);
};

const isClassBookingIntent = (message = "") => {
  const normalized = normalizeOptionText(message);
  return Boolean(
    /\b(?:i want to|i would like to|id like to|please|can i|could i|help me)\b.*\b(?:book|register|enrol|enroll|join)\b.*\b(?:class|session|course|programme|program)\b/.test(normalized)
    || /\b(?:book|register|enrol|enroll|join)\b.*\b(?:class|session|course|programme|program)\b/.test(normalized)
    || /\b(?:register|enrol|enroll)\b.*\b(?:child|student|learner)\b/.test(normalized)
  );
};

export const isPackageInformationIntent = (message = "") => {
  const normalized = normalizeOptionText(message);
  return packageInformationPattern.test(normalized) && reservationActionPattern.test(normalized);
};

export const isRestaurantReservationIntent = (message = "") => {
  const normalized = normalizeOptionText(message);
  if (meetingOrCallbackPattern.test(normalized)) return false;
  return restaurantReservationPattern.test(normalized) && restaurantActionPattern.test(normalized);
};

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
  if (["book", "booking", "reservation", "reserve"].includes(normalized)) return true;
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
  if (/^(?:what|how|why|do you|does your|tell me|explain|can i cancel|can i change)\b/.test(normalized)) return false;
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;
  return words.some((word) => naturalServiceWords.has(word));
};

export const isReservationDomainIntent = (message = "") => {
  const normalized = normalizeOptionText(message);
  if (meetingOrCallbackPattern.test(normalized)) return false;
  return isGenericBookingIntent(message)
    || isNaturalServiceBookingIntent(message)
    || isClassBookingIntent(message)
    || isClassInformationIntent(message)
    || isPackageInformationIntent(message)
    || isRestaurantReservationIntent(message);
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

const scheduledServiceBookingTypes = new Set(["class", "course"]);

const isEligibleScheduledService = (service) => (
  service?.schedulingMode === "scheduled"
  && scheduledServiceBookingTypes.has(String(service?.bookingType || "").toLowerCase())
);

const hasValidTimezone = (timezone) => {
  if (!String(timezone || "").trim()) return false;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(); return true; } catch { return false; }
};

const scheduledSessionLabel = (session) => {
  const date = session.startsAt && hasValidTimezone(session.timezone) ? new Date(session.startsAt).toLocaleDateString("en-GB", { timeZone: session.timezone, day: "numeric", month: "long", year: "numeric" }) : "date to be confirmed";
  const time = session.startsAt && hasValidTimezone(session.timezone) ? new Date(session.startsAt).toLocaleTimeString("en-GB", { timeZone: session.timezone, hour: "2-digit", minute: "2-digit" }) : "time to be confirmed";
  const teacher = session.staffName ? ` with ${session.staffName}` : "";
  return `${date} at ${time}${teacher}`;
};

const scheduledSessionOptions = (sessions) => sessions.filter((session) => hasValidTimezone(session.timezone)).map((session) => ({
  ...session,
  name: scheduledSessionLabel(session),
})).sort((left, right) => new Date(left.startsAt || 0) - new Date(right.startsAt || 0));

const parseRestaurantQuantity = (message, { exact = false } = {}) => {
  const normalized = normalizeOptionText(message);
  const token = normalized.match(/(?:party of|for)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i)?.[1]
    || normalized.match(/(?:^|\s)(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:guests?|people|persons?)\b/i)?.[1]
    || (exact ? normalized.match(/^(\d+)$/)?.[1] : null);
  if (!token) return null;
  return Number.isFinite(Number(token)) ? Number(token) : restaurantNumberWords[token.toLowerCase()] || null;
};

const extractRestaurantDate = (message) => {
  const normalized = normalizeOptionText(message);
  const structured = normalized.match(/\b\d{4}[-./]\d{2}[-./]\d{2}\b/);
  if (structured) return structured[0];
  const natural = normalized.match(/\b(?:today|tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)|(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2})\b/i);
  return natural?.[0] || null;
};

const parseRestaurantTime = (message) => {
  const normalized = normalizeOptionText(message);
  const match = normalized.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match || (match[1].length === 4 && !match[2])) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59 || hour > 23 || (meridiem && hour > 12)) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const loadRestaurantSettings = async (context, readAdapter) => {
  if (typeof readAdapter.getRestaurantSettings === "function") return readAdapter.getRestaurantSettings(context);
  return context.configuration?.restaurantSettings || {};
};

const restaurantTimeMatches = (slot, requested) => String(slot?.localTime || "").slice(0, 5) === requested;

const restaurantSlotReply = (slots, localDate) => slots.length
  ? `Available restaurant times on ${localDate}:\n\n${slots.map((slot, index) => `${index + 1}. ${formatTimeForDisplay(slot.localTime)}`).join("\n")}`
  : `There are no restaurant times available on ${localDate} for that party size. Please choose another date.`;

const capabilityLabel = (terminology, singularKey, fallback) =>
  terminology?.[singularKey] || fallback;

const buildPackageInformationReply = async ({ context, readAdapter }) => {
  const capabilities = context.configuration?.capabilities || {};
  const terminology = context.configuration?.terminology || {};
  const packageLabel = capabilityLabel(terminology, "servicePlural", "services");
  if (capabilities.packages !== true) return `Packages are not enabled for this ${packageLabel.toLowerCase()} catalogue.`;

  const services = await readAdapter.listBookableServices(context);
  const packageServices = services.filter((service) => service.packageSessionCount || service.packageValidityDays);
  if (!packageServices.length) return "Packages are enabled, but no package options are currently configured or available.";
  const lines = packageServices.map((service) => {
    const details = [
      service.packageSessionCount ? `${service.packageSessionCount} session(s)` : null,
      service.packageValidityDays ? `valid for ${service.packageValidityDays} day(s)` : null,
    ].filter(Boolean).join(", ");
    return `${service.name}${details ? ` (${details})` : ""}`;
  });
  return `Available package options:\n\n${lines.map((line, index) => `${index + 1}. ${line}`).join("\n")}`;
};

const buildClassInformationReply = async ({ context, readAdapter }) => {
  const capabilities = context.configuration?.capabilities || {};
  const terminology = context.configuration?.terminology || {};
  const classLabel = capabilityLabel(terminology, "servicePlural", "classes");
  if (capabilities.scheduledSessions !== true) return `${classLabel} and scheduled sessions are not enabled for this business.`;

  const services = await readAdapter.listBookableServices(context);
  const sessions = [];
  if (typeof readAdapter.listScheduledSessions === "function") {
    for (const service of services) {
      const serviceSessions = await readAdapter.listScheduledSessions(context, { serviceSlug: service.slug });
      for (const session of serviceSessions || []) sessions.push({ ...session, serviceName: service.name });
    }
  }
  if (!sessions.length) return `No bookable ${classLabel.toLowerCase()} or scheduled sessions are currently available.`;
  const lines = sessions.map((session) => `${session.serviceName || classLabel.slice(0, -1)} — ${scheduledSessionLabel(session)}`);
  return `Available ${classLabel.toLowerCase()}:\n\n${lines.map((line, index) => `${index + 1}. ${line}`).join("\n")}`;
};

const listEligibleScheduledServices = async (context, readAdapter) => (
  (await readAdapter.listBookableServices(context)).filter(isEligibleScheduledService)
);

const listScheduledSessionOptions = async (context, readAdapter, service) => {
  if (typeof readAdapter.listScheduledSessions !== "function") return [];
  const sessions = await readAdapter.listScheduledSessions(context, { serviceSlug: service.slug });
  return scheduledSessionOptions((sessions || []).filter((session) => session?.id !== null && session?.id !== undefined));
};

const startScheduledSessionFlow = async ({ context, session, message, readAdapter }) => {
  if (/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:students?|learners?)\b/i.test(String(message || ""))) {
    return { handled: true, reply: "I can prepare one student registration at a time. Please request one student.", reservation: buildReservationResponse({ reply: "", flowStatus: "idle", journeyType: "scheduled_session" }).reservation };
  }
  const flow = initializeReservationFlow({ context, session, journeyType: "scheduled_session" });
  flow.quantity = 1;
  const services = await measureAiReservationStage({ context, flow, stage: "services_read", operation: "list_bookable_scheduled_services" }, () => listEligibleScheduledServices(context, readAdapter));
  if (!services.length) {
    delete session.reservationFlow;
    return { handled: true, reply: "No bookable classes or scheduled sessions are currently available.", reservation: buildReservationResponse({ reply: "", flowStatus: "idle", journeyType: "scheduled_session" }).reservation };
  }
  flow.selectionOptions = services.map(({ id, slug, name }) => ({ id, slug, name }));
  session.reservationFlow = flow;
  return { handled: true, reply: optionReply("class", services), reservation: reservationPayload(session, flow, "") };
};

const buildRestaurantCapabilityReply = ({ context }) => {
  const capabilities = context.configuration?.capabilities || {};
  const terminology = context.configuration?.terminology || {};
  const guestLabel = capabilityLabel(terminology, "guestPlural", "guests");
  if (capabilities.guestCount !== true) return "Restaurant-style guest-count reservations are not enabled for this business.";
  return `Restaurant reservations are available for ${guestLabel.toLowerCase()}, but typed table booking in chat is not available yet. Please use the Reservations form or contact the team for help.`;
};

const clearServiceDependents = (flow) => {
  for (const key of ["providerId", "providerSlug", "providerName", "scheduledSessionId", "scheduledSessionEndsAt", "scheduledSessionRemainingCapacity", "localDate", "startsAt", "endsAt", "localTime", "timezone", "formFieldIndex", "currentCustomField", "customFieldIndex", "customerFormSnapshot", "customer", "customData", "confirmation", "bookingAttemptId", "idempotencyKey"]) delete flow[key];
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
  flow.timezone = provider.timezone || null;
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

const beginRestaurantCustomerForm = async ({ context, session, flow, readAdapter }) => {
  flow.customerFormSnapshot = await measureAiReservationStage({ context, flow, stage: "customer_form_read", operation: "get_customer_form" }, () => readAdapter.getCustomerForm(context));
  flow.formFieldIndex = 0;
  const next = findNextCustomerFormField(flow);
  flow.status = "customer_form";
  session.reservationFlow = flow;
  return next ? buildCustomerFormPrompt(next) : "What is the full name for this reservation?";
};

const startRestaurantFlow = async ({ context, session, message, readAdapter, now }) => {
  const flow = initializeReservationFlow({ context, session, journeyType: "restaurant" });
  const settings = await loadRestaurantSettings(context, readAdapter);
  flow.timezone = settings.timezone || null;
  const quantity = parseRestaurantQuantity(message, { exact: false });
  if (quantity === null) {
    return { handled: true, reply: "How many guests should I reserve for? Please provide a positive whole number.", reservation: reservationPayload(session, flow, "") };
  }
  const maxGuests = Number(settings.maxGuests || 0) || null;
  if (!Number.isInteger(quantity) || quantity < 1 || (maxGuests && quantity > maxGuests)) {
    return { handled: true, reply: maxGuests ? `I can only accept parties of up to ${maxGuests} guests. Please choose a smaller party size.` : "Please provide a positive whole number of guests.", reservation: reservationPayload(session, flow, "") };
  }
  flow.quantity = quantity;
  flow.status = "date_selection";
  const dateInput = extractRestaurantDate(message);
  if (!dateInput) {
    session.reservationFlow = flow;
    return { handled: true, reply: "What date would you like for the reservation? You can say tomorrow or enter YYYY-MM-DD.", reservation: reservationPayload(session, flow, "") };
  }
  const date = parseNaturalReservationDate(dateInput, { timezone: flow.timezone, now: now() });
  if (!date.valid) {
    session.reservationFlow = flow;
    return { handled: true, reply: date.message, reservation: reservationPayload(session, flow, "") };
  }
  flow.localDate = date.value;
  const slots = await measureAiReservationStage({ context, flow, stage: "availability_read", operation: "list_restaurant_availability" }, () => readAdapter.listRestaurantAvailability(context, flow.localDate, flow.quantity));
  flow.selectionOptions = slots;
  flow.status = slots.length ? "slot_selection" : "date_selection";
  const requestedTime = parseRestaurantTime(message);
  if (requestedTime) {
    const selected = slots.find((slot) => restaurantTimeMatches(slot, requestedTime));
    if (!selected) {
      session.reservationFlow = flow;
      return { handled: true, reply: slots.length ? `That time is not available.\n\n${restaurantSlotReply(slots, flow.localDate)}` : restaurantSlotReply(slots, flow.localDate), reservation: reservationPayload(session, flow, "") };
    }
    flow.localTime = selected.localTime;
    flow.startsAt = selected.startsAt;
    flow.timezone = selected.timezone || flow.timezone;
    const reply = await beginRestaurantCustomerForm({ context, session, flow, readAdapter });
    return { handled: true, reply, reservation: reservationPayload(session, flow, "") };
  }
  session.reservationFlow = flow;
    return { handled: true, reply: restaurantSlotReply(slots, flow.localDate), reservation: reservationPayload(session, flow, "") };
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
  now = () => new Date(),
} = {}) {
  const current = session.reservationFlow;
  const startRequested = isReservationDomainIntent(message) || isRestartMessage(message);
  const startFlow = async () => {
    const naturalServiceStart = isNaturalServiceBookingIntent(message) && !isGenericBookingIntent(message);
    const journey = await measureAiReservationStage({ context, stage: "journey_resolution", operation: "resolve_reservation_journey" }, async () => resolveChatReservationJourney({ configuration: context.configuration }));
    if (isClassInformationIntent(message)) {
      return { handled: true, reply: await buildClassInformationReply({ context, readAdapter }), reservation: buildReservationResponse({ reply: "", flowStatus: "idle", journeyType: journey.journeyType }).reservation };
    }
    if (isPackageInformationIntent(message)) {
      return { handled: true, reply: await buildPackageInformationReply({ context, readAdapter }), reservation: buildReservationResponse({ reply: "", flowStatus: "idle", journeyType: journey.journeyType }).reservation };
    }
    if (journey.journeyType === "scheduled_session") {
      return startScheduledSessionFlow({ context, session, message, readAdapter });
    }
    if (journey.journeyType === "restaurant" || isRestaurantReservationIntent(message)) {
      const restaurantEnabled = context.configuration?.capabilities?.guestCount === true;
      if (!restaurantEnabled) return { handled: true, reply: buildRestaurantCapabilityReply({ context }), reservation: buildReservationResponse({ reply: "", flowStatus: "idle", journeyType: null }).reservation };
      return startRestaurantFlow({ context, session, message, readAdapter, now });
    }
    if (journey.journeyType !== "appointment" || !supportedTemplates.has(journey.templateKey)) {
      const templateLabel = context.configuration?.terminology?.servicePlural || "reservations";
      return { handled: true, reply: `${templateLabel} are supported, but this typed Reservations journey is not available yet. Please use the Reservations form or contact the team for help.`, reservation: buildReservationResponse({ reply: "", flowStatus: "idle", journeyType: journey.journeyType }).reservation };
    }
    const flow = initializeReservationFlow({ context, session, journeyType: "appointment" });
    const services = await measureAiReservationStage({ context, flow, stage: "services_read", operation: "list_bookable_services" }, () => readAdapter.listBookableServices(context));
    if (!services.length) {
      if (naturalServiceStart) {
        delete session.reservationFlow;
        return { handled: false };
      }
      return { handled: true, reply: "No appointment services are available right now.", reservation: reservationPayload(session, flow, "") };
    }
    flow.selectionOptions = services.map(({ id, slug, name }) => ({ id, slug, name }));
    const service = matchService(message, services);
    if (service) {
      applyService(flow, service);
      const providers = await measureAiReservationStage({ context, flow, stage: "providers_read", operation: "list_bookable_providers" }, () => readAdapter.listBookableProviders(context, service));
      if (!providers.length) return { handled: true, reply: "No providers are available for that service.", reservation: reservationPayload(session, flow, "") };
      flow.status = "provider_selection";
      flow.selectionOptions = providers.map(({ id, slug, displayName, timezone }) => ({ id, slug, displayName, timezone }));
      session.reservationFlow = flow;
      return { handled: true, reply: optionReply("provider", providers), reservation: reservationPayload(session, flow, "") };
    }
    const query = stripBookingWrapper(message).split(" ").filter(Boolean);
    const hasServiceCandidate = services.some((candidate) => {
      const candidateWords = new Set(normalizeOptionText(candidate.name).split(" "));
      return [candidate.name, candidate.slug].some((value) => normalizeOptionText(value) === normalizeOptionText(message))
        || (query.length > 0 && query.every((word) => candidateWords.has(word)));
    });
    if (naturalServiceStart && !hasServiceCandidate) {
      delete session.reservationFlow;
      return { handled: false };
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
    if (flow.journeyType === "scheduled_session") {
      const prepared = await measureAiReservationStage({ context, flow, stage: "confirmation_preparation", operation: "prepare_scheduled_session_confirmation" }, () => prepareScheduledSessionConfirmation({
        context,
        session,
        flow,
        service: { id: flow.serviceId, slug: flow.serviceSlug, name: flow.serviceName },
        customer: flow.customer,
        form: flow.customerFormSnapshot,
      }));
      return { handled: true, reply: formatReservationConfirmationSummary(prepared.summary), reservation: reservationPayload(session, session.reservationFlow, "") };
    }
    if (context.configuration.bookingBehavior?.booking_behavior === "request") {
      flow.status = "completed";
      flow.requestedBooking = true;
      return { handled: true, reply: "I’ve collected the appointment details. Please submit them through the Reservations form so the team can review the request.", reservation: reservationPayload(session, flow, "") };
    }
    const prepared = await measureAiReservationStage({ context, flow, stage: "confirmation_preparation", operation: "prepare_reservation_confirmation" }, () => prepareReservationConfirmation({
      context,
      session,
      flow,
      service: flow.journeyType === "restaurant" ? null : { id: flow.serviceId, slug: flow.serviceSlug, name: flow.serviceName },
      provider: flow.journeyType === "restaurant" ? null : { id: flow.providerId, slug: flow.providerSlug, displayName: flow.providerName },
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
    return { handled: true, reply: `Okay, I cancelled the ${flow.journeyType === "restaurant" ? "restaurant reservation" : "appointment booking"}.`, reservation: reservationPayload(session, session.reservationFlow, "") };
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
    const reply = result.flowStatus === "cancelled"
      ? "Okay, I cancelled the Learning Centre registration."
      : result.errorCode === "BOOKING_RESULT_UNKNOWN"
      ? "We’re checking whether your appointment was created. Please don’t submit it again yet."
      : result.errorCode === "BOOKING_IN_PROGRESS"
        ? "We’re still checking whether your appointment was created. Please don’t submit it again yet."
      : result.bookingCreated
      ? formatReservationSuccessResponse(result.summary || flow.confirmation?.summary || {}, { ...(result.result || {}), confirmationEmail: result.confirmationEmail })
      : result.errorCode === "SCHEDULED_SESSION_BOOKING_NOT_ENABLED"
        ? "Your Learning Centre registration details are confirmed. Scheduled-session booking is not enabled yet, so no registration was created."
      : result.fallbackRequired
        ? "I could not safely complete that appointment in chat. Please use the Reservations form or request a callback."
        : "Please reply **yes** to confirm or **no** to cancel.";
    return { handled: true, reply, reservation: reservationPayload(session, session.reservationFlow, reply, result.errorCode) };
  }

  if (flow.journeyType === "restaurant" && flow.status === "guest_count") {
    const quantity = parseRestaurantQuantity(message, { exact: true });
    const settings = await loadRestaurantSettings(context, readAdapter);
    const maxGuests = Number(settings.maxGuests || 0) || null;
    if (!Number.isInteger(quantity) || quantity < 1 || (maxGuests && quantity > maxGuests)) {
      return { handled: true, reply: maxGuests ? `I can only accept parties of up to ${maxGuests} guests. Please enter a smaller whole number.` : "Please enter a positive whole number of guests.", reservation: reservationPayload(session, flow, "") };
    }
    flow.quantity = quantity;
    flow.timezone = settings.timezone || flow.timezone || null;
    flow.status = "date_selection";
    return { handled: true, reply: "What date would you like for the reservation? You can say tomorrow or enter YYYY-MM-DD.", reservation: reservationPayload(session, flow, "") };
  }

  if (flow.journeyType === "restaurant" && flow.status === "date_selection") {
    const date = parseNaturalReservationDate(message, { timezone: flow.timezone, now: now() });
    if (!date.valid) return { handled: true, reply: date.message, reservation: reservationPayload(session, flow, "") };
    const slots = await measureAiReservationStage({ context, flow, stage: "availability_read", operation: "list_restaurant_availability" }, () => readAdapter.listRestaurantAvailability(context, date.value, flow.quantity));
    flow.localDate = date.value;
    flow.selectionOptions = slots;
    flow.status = slots.length ? "slot_selection" : "date_selection";
    const requestedTime = parseRestaurantTime(message);
    if (requestedTime) {
      const selected = slots.find((slot) => restaurantTimeMatches(slot, requestedTime));
      if (!selected) return { handled: true, reply: slots.length ? `That time is not available.\n\n${restaurantSlotReply(slots, date.value)}` : restaurantSlotReply(slots, date.value), reservation: reservationPayload(session, flow, "") };
      flow.localTime = selected.localTime;
      flow.startsAt = selected.startsAt;
      flow.timezone = selected.timezone || flow.timezone;
      const reply = await beginRestaurantCustomerForm({ context, session, flow, readAdapter });
      return { handled: true, reply, reservation: reservationPayload(session, flow, "") };
    }
    return { handled: true, reply: restaurantSlotReply(slots, date.value), reservation: reservationPayload(session, flow, "") };
  }

  if (flow.journeyType === "restaurant" && flow.status === "slot_selection") {
    const options = flow.selectionOptions || [];
    const input = String(message ?? "").trim();
    const isBareInteger = /^\d+$/.test(input);
    const isSignedInteger = /^-?\d+$/.test(input);
    const requestedTime = isSignedInteger ? null : parseRestaurantTime(message);
    const resolved = isBareInteger
      ? resolveOption(message, options, "localTime")
      : isSignedInteger
        ? { status: "none", option: null, matches: [] }
        : requestedTime
          ? { status: "matched", option: options.find((slot) => restaurantTimeMatches(slot, requestedTime)) }
          : resolveOption(message, options, "localTime");
    const slot = resolved.status === "matched" ? resolved.option : null;
    if (!slot) return { handled: true, reply: optionSelectionReply("time", flow.selectionOptions || [], message, resolved), reservation: reservationPayload(session, flow, "") };
    flow.localTime = slot.localTime;
    flow.startsAt = slot.startsAt;
    flow.timezone = slot.timezone || flow.timezone;
    const reply = await beginRestaurantCustomerForm({ context, session, flow, readAdapter });
    return { handled: true, reply, reservation: reservationPayload(session, flow, "") };
  }

  if (flow.status === "service_selection") {
    const resolved = resolveOption(message, flow.selectionOptions || []);
    const service = resolved.status === "matched" ? resolved.option : matchService(message, flow.selectionOptions || []);
    if (resolved.status === "ambiguous") return { handled: true, reply: optionSelectionReply("service", flow.selectionOptions || [], message, resolved), reservation: reservationPayload(session, flow, "") };
    if (!service) return { handled: true, reply: optionSelectionReply("service", flow.selectionOptions || [], message, resolved), reservation: reservationPayload(session, flow, "") };
    applyService(flow, service);
    if (flow.journeyType === "scheduled_session") {
      const sessions = await measureAiReservationStage({ context, flow, stage: "scheduled_sessions_read", operation: "list_public_scheduled_sessions" }, () => listScheduledSessionOptions(context, readAdapter, service));
      if (!sessions.length) return { handled: true, reply: "No upcoming sessions are currently available for that class.", reservation: reservationPayload(session, flow, "") };
      flow.selectionOptions = sessions;
      flow.status = "slot_selection";
      return { handled: true, reply: optionReply("session", sessions), reservation: reservationPayload(session, flow, "") };
    }
    const providers = await measureAiReservationStage({ context, flow, stage: "providers_read", operation: "list_bookable_providers" }, () => readAdapter.listBookableProviders(context, service));
    if (!providers.length) return { handled: true, reply: "No providers are available for that service.", reservation: reservationPayload(session, flow, "") };
    flow.status = "provider_selection";
    flow.selectionOptions = providers.map(({ id, slug, displayName, timezone }) => ({ id, slug, displayName, timezone }));
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
    const date = parseNaturalReservationDate(message, { timezone: flow.timezone, now: now() });
    if (!date.valid) return { handled: true, reply: date.message, reservation: reservationPayload(session, flow, "") };
    const slots = await measureAiReservationStage({ context, flow, stage: "availability_read", operation: "list_appointment_availability" }, () => readAdapter.listAppointmentAvailability(context, { serviceId: flow.serviceId, serviceSlug: flow.serviceSlug, providerId: flow.providerId, providerSlug: flow.providerSlug, localDate: date.value, timezone: flow.timezone }));
    if (!slots.length) return { handled: true, reply: "No appointment times are available on that date. Please choose another date.", reservation: reservationPayload(session, flow, "") };
    clearDateDependents(flow);
    flow.localDate = date.value;
    flow.selectionOptions = slots;
    flow.status = "slot_selection";
    return { handled: true, reply: optionReply("time", slots), reservation: reservationPayload(session, flow, "") };
  }

  if (flow.status === "slot_selection") {
    if (flow.journeyType === "scheduled_session") {
      const options = flow.selectionOptions || [];
      const input = String(message ?? "").trim();
      const resolved = resolveOption(message, options, "name");
      let sessionOption = resolved.status === "matched" ? resolved.option : null;
      if (!sessionOption && /^(?:next\s+)?class$/i.test(input)) sessionOption = options[0] || null;
      if (!sessionOption && !/^\d+$/.test(input)) {
        const timeMatch = input.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
          || input.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i)
          || input.match(/\b(\d{1,2})\s*(am|pm)\b/i);
        const dateInput = input.replace(/\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*$/i, "").trim();
        const date = parseNaturalReservationDate(dateInput, { timezone: options[0]?.timezone || null, now: now() });
        if (date.valid) {
          const candidates = options.filter((option) => {
            const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: option.timezone || "UTC" }).format(new Date(option.startsAt));
            if (localDate !== date.value) return false;
            if (!timeMatch) return true;
            let hour = Number(timeMatch[1]);
            const minute = Number(timeMatch[2] || 0);
            if (timeMatch[3]?.toLowerCase() === "pm" && hour < 12) hour += 12;
            if (timeMatch[3]?.toLowerCase() === "am" && hour === 12) hour = 0;
            const localTime = new Intl.DateTimeFormat("en-GB", { timeZone: option.timezone || "UTC", hour: "2-digit", minute: "2-digit" }).format(new Date(option.startsAt));
            return localTime === `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
          });
          if (candidates.length === 1) sessionOption = candidates[0];
          else if (candidates.length > 1) return { handled: true, reply: `I found more than one session on ${date.value}. Please choose a numbered option.\n\n${optionReply("session", candidates)}`, reservation: reservationPayload(session, flow, "") };
        }
      }
      if (!sessionOption) return { handled: true, reply: optionSelectionReply("session", options, message, resolved), reservation: reservationPayload(session, flow, "") };
      flow.scheduledSessionId = String(sessionOption.id);
      flow.startsAt = sessionOption.startsAt;
      flow.endsAt = sessionOption.endsAt || null;
      flow.scheduledSessionEndsAt = sessionOption.endsAt || null;
      flow.scheduledSessionRemainingCapacity = sessionOption.remainingCapacity ?? null;
      flow.timezone = sessionOption.timezone || null;
      flow.providerName = sessionOption.staffName || null;
      flow.localDate = new Intl.DateTimeFormat("en-CA", { timeZone: flow.timezone || "UTC" }).format(new Date(flow.startsAt));
      flow.localTime = new Intl.DateTimeFormat("en-GB", { timeZone: flow.timezone || "UTC", hour: "2-digit", minute: "2-digit" }).format(new Date(flow.startsAt));
      const form = await measureAiReservationStage({ context, flow, stage: "customer_form_read", operation: "get_customer_form" }, () => readAdapter.getCustomerForm(context));
      flow.customerFormSnapshot = form;
      flow.formFieldIndex = 0;
      const next = findNextCustomerFormField(flow);
      flow.status = "customer_form";
      return { handled: true, reply: next ? buildCustomerFormPrompt(next) : "What is your full name?", reservation: reservationPayload(session, flow, "") };
    }
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
    if (flow.journeyType === "restaurant") {
      const fields = customerFormFields(flow);
      const field = fields.find((item) => String(item.id) === String(flow.currentCustomField));
      if (!field) return prepareConfirmation();
      const skipRequested = isOptionalCustomerFormSkip(message);
      if (!field.required && skipRequested) {
        delete flow.customData[field.id];
      } else if (field.required && skipRequested) {
        return { handled: true, reply: `This field is required. Please enter ${field.label}.`, reservation: reservationPayload(session, flow, "") };
      } else {
        const parsed = parseCustomerFormInput(customerFormValidationField(field), message);
        const validation = parsed.valid ? validateCustomerFormValue(customerFormValidationField(field), parsed.value) : parsed;
        if (!validation.valid) return { handled: true, reply: `${buildCustomerFormValidationMessage(customerFormValidationField(field), validation)} Please try again.`, reservation: reservationPayload(session, flow, "") };
        const coreKey = getCustomerCoreFieldKey(field);
        if (coreKey) flow.customer = { ...(flow.customer || {}), [coreKey]: parsed.value };
        flow.customData = { ...(flow.customData || {}), [field.id]: parsed.value };
      }
      flow.customFieldIndex = Number(flow.customFieldIndex || 0) + 1;
      const next = findNextCustomerFormField(flow);
      if (next) return { handled: true, reply: buildCustomerFormPrompt(next), reservation: reservationPayload(session, flow, "") };
      clearCustomerFormSelection(flow);
      return prepareConfirmation();
    }
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
