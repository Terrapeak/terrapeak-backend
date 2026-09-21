import { resolveChatReservationJourney } from "./chatReservationJourneyService.js";
import { initializeReservationFlow, prepareReservationConfirmation, confirmReservationFoundation, buildReservationResponse } from "./aiReservationFlowService.js";
import { parseCustomerFormInput, validateCustomerFormValue } from "../utils/aiReservationCustomerForm.js";

const supportedTemplates = new Set(["general", "physiotherapy", "dental", "salon"]);
const isStartMessage = (message) => /\b(book|booking|schedule|appointment)\b/i.test(String(message));
const isCancelMessage = (message) => /^(cancel|stop|exit|quit)$/i.test(String(message).trim());

const selectOption = (message, options, labelKey = "name") => {
  const value = String(message || "").trim();
  const numeric = Number.parseInt(value, 10);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= options.length) return options[numeric - 1];
  return options.find((option) => [option.slug, option[labelKey], option.id].some((candidate) => String(candidate || "").toLowerCase() === value.toLowerCase())) || null;
};

const optionReply = (label, options) => `Please choose a ${label}:\n\n${options.map((option, index) => `${index + 1}. ${option.name || option.displayName || option.localTime}`).join("\n")}`;

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
  if (!current?.status || current.status === "idle") {
    if (!isStartMessage(message)) return { handled: false };
    const journey = resolveChatReservationJourney({ configuration: context.configuration });
    if (journey.journeyType !== "appointment" || !supportedTemplates.has(journey.templateKey)) return { handled: false };
    const flow = initializeReservationFlow({ context, session, journeyType: "appointment" });
    const services = await readAdapter.listBookableServices(context);
    if (!services.length) return { handled: true, reply: "No appointment services are available right now.", reservation: reservationPayload(session, flow, "") };
    flow.selectionOptions = services.map(({ id, slug, name }) => ({ id, slug, name }));
    session.reservationFlow = flow;
    return { handled: true, reply: optionReply("service", services), reservation: reservationPayload(session, flow, "") };
  }

  const flow = current;
  if (isCancelMessage(message)) {
    flow.status = "cancelled";
    return { handled: true, reply: "Okay, I cancelled the appointment booking.", reservation: reservationPayload(session, flow, "") };
  }

  if (flow.status === "awaiting_confirmation") {
    const result = await confirmReservationFoundation({
      context,
      session,
      message,
      apiKey,
      model,
      readAdapter,
      writeAdapter,
      contextResolver,
    });
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
    const service = selectOption(message, flow.selectionOptions || []);
    if (!service) return { handled: true, reply: optionReply("service", flow.selectionOptions || []), reservation: reservationPayload(session, flow, "") };
    flow.serviceId = service.id;
    flow.serviceSlug = service.slug;
    flow.serviceName = service.name;
    const providers = await readAdapter.listBookableProviders(context, service);
    if (!providers.length) return { handled: true, reply: "No providers are available for that service.", reservation: reservationPayload(session, flow, "") };
    flow.status = "provider_selection";
    flow.selectionOptions = providers.map(({ id, slug, displayName }) => ({ id, slug, displayName }));
    return { handled: true, reply: optionReply("provider", providers), reservation: reservationPayload(session, flow, "") };
  }

  if (flow.status === "provider_selection") {
    const provider = selectOption(message, flow.selectionOptions || [], "displayName");
    if (!provider) return { handled: true, reply: optionReply("provider", flow.selectionOptions || []), reservation: reservationPayload(session, flow, "") };
    flow.providerId = provider.id;
    flow.providerSlug = provider.slug;
    flow.providerName = provider.displayName;
    flow.status = "date_selection";
    return { handled: true, reply: "What date would you like? Please use YYYY-MM-DD.", reservation: reservationPayload(session, flow, "") };
  }

  if (flow.status === "date_selection") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(message).trim())) return { handled: true, reply: "Please provide a valid date in YYYY-MM-DD format.", reservation: reservationPayload(session, flow, "") };
    const slots = await readAdapter.listAppointmentAvailability(context, { serviceId: flow.serviceId, serviceSlug: flow.serviceSlug, providerId: flow.providerId, providerSlug: flow.providerSlug, localDate: String(message).trim() });
    if (!slots.length) return { handled: true, reply: "No appointment times are available on that date. Please choose another date.", reservation: reservationPayload(session, flow, "") };
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
      const form = await readAdapter.getCustomerForm(context);
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

    const summary = await prepareReservationConfirmation({
      context,
      session,
      flow,
      service: { id: flow.serviceId, slug: flow.serviceSlug, name: flow.serviceName },
      provider: { id: flow.providerId, slug: flow.providerSlug, displayName: flow.providerName },
      slot: { startsAt: flow.startsAt, timezone: flow.timezone },
      customer: flow.customer,
      form: flow.customerFormSnapshot,
      model,
    });
    return { handled: true, reply: `${summary.summary.serviceName || "Your appointment"} is ready. Reply **yes** to confirm or **no** to cancel.`, reservation: reservationPayload(session, session.reservationFlow, "") };
  }

  return { handled: false };
}
