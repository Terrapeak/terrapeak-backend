import { isTransactionalAiReservationsEnabled } from "./chatReservationContextService.js";
import { getOrCreateReservationBookingAttempt } from "./reservationBookingAttemptService.js";
import { logAiReservationEvent } from "../utils/aiReservationLogger.js";
import { randomUUID } from "node:crypto";

export const RESERVATION_FLOW_STATES = Object.freeze([
  "idle", "service_selection", "provider_selection", "date_selection",
  "slot_selection", "customer_form", "review", "awaiting_confirmation",
  "ready_to_commit", "completed", "cancelled", "failed",
]);

const confirmationWords = new Set(["confirm", "yes", "yes confirm", "book it", "confirm booking"]);
const negativeWords = new Set(["no", "cancel", "change time", "go back"]);

export function initializeReservationFlow({ context, journeyType = "appointment", session }) {
  const flow = {
    version: 1,
    status: "service_selection",
    journeyType,
    companyId: context.companyId,
    installationId: context.installationId,
    businessId: String(context.reservationBusinessId),
    businessSlug: context.reservationBusinessSlug,
    templateKey: context.configuration.templateKey,
    timezone: null,
    quantity: 1,
    customer: {},
    customData: {},
    customerFormSnapshot: [],
    displaySnapshot: {},
    confirmation: {},
    bookingAttemptId: randomUUID(),
    idempotencyKey: null,
  };
  session.reservationFlow = flow;
  return flow;
}

export const parseReservationConfirmation = (message = "") => {
  const normalized = String(message).trim().toLowerCase().replace(/[.!]+$/, "");
  if (confirmationWords.has(normalized)) return "confirm";
  if (negativeWords.has(normalized)) return "reject";
  return "unknown";
};

export const buildReservationConfirmationSummary = ({ context, flow, service, provider, slot, customer, form }) => ({
  businessId: context.reservationBusinessId,
  businessSlug: context.reservationBusinessSlug,
  serviceId: service?.id || flow.serviceId || null,
  serviceName: service?.name || null,
  providerId: provider?.id || flow.providerId || null,
  providerName: provider?.displayName || null,
  startsAt: slot?.startsAt || flow.startsAt || null,
  endsAt: slot?.endsAt || null,
  localTime: slot?.localTime || null,
  timezone: slot?.timezone || null,
  durationMinutes: provider?.customDurationMinutes || service?.durationMinutes || null,
  price: provider?.customPrice ?? service?.price ?? null,
  currency: service?.currency || null,
  quantity: flow.quantity || 1,
  customer: {
    name: customer?.name || null,
    email: customer?.email || null,
    phone: customer?.phone || null,
  },
  bookingBehavior: context.configuration.bookingBehavior,
  terminology: context.configuration.terminology,
  formFieldCount: Array.isArray(form) ? form.length : 0,
});

export async function prepareReservationConfirmation({ context, session, flow, service, provider, slot, customer, form, model }) {
  const summary = buildReservationConfirmationSummary({ context, flow, service, provider, slot, customer, form });
  const bookingAttemptId = flow.bookingAttemptId || randomUUID();
  const attempt = await getOrCreateReservationBookingAttempt({
    context,
    journeyType: flow.journeyType || "appointment",
    request: {
      version: 1,
      bookingAttemptId,
      fingerprintInput: {
        companyId: context.companyId,
        chatbotId: context.chatbotId,
        sessionId: context.sessionId,
        businessId: context.reservationBusinessId,
        journeyType: flow.journeyType || "appointment",
        serviceId: summary.serviceId,
        providerId: summary.providerId,
        scheduledSessionId: flow.scheduledSessionId || null,
        startsAt: summary.startsAt,
        endsAt: summary.endsAt,
        localTime: summary.localTime,
        timezone: summary.timezone,
        quantity: summary.quantity,
        customer: summary.customer,
        customData: flow.customData || {},
        bookingBehavior: summary.bookingBehavior,
      },
    },
    ...(model ? { model } : {}),
  });
  session.reservationFlow = {
    ...flow,
    status: "awaiting_confirmation",
    companyId: context.companyId,
    businessId: String(context.reservationBusinessId),
    bookingAttemptId: attempt.attempt.bookingAttemptId,
    idempotencyKey: attempt.idempotencyKey,
    confirmation: { required: true, summary },
  };
  logAiReservationEvent("reservation_confirmation_prepared", {
    companyId: context.companyId,
    chatbotId: context.chatbotId,
    businessId: context.reservationBusinessId,
    journeyType: flow.journeyType || "appointment",
    attemptId: attempt.attempt.bookingAttemptId,
    flowStatus: "awaiting_confirmation",
  });
  return { summary, attempt, flowStatus: "awaiting_confirmation" };
}

export async function confirmReservationFoundation({ context, session, message, env = process.env }) {
  const flow = session?.reservationFlow;
  if (!flow || flow.status !== "awaiting_confirmation") {
    return { flowStatus: flow?.status || "idle", confirmationRequired: true, errorCode: "CONFIRMATION_REQUIRED" };
  }
  const decision = parseReservationConfirmation(message);
  if (decision === "reject") {
    session.reservationFlow.status = "cancelled";
    return { flowStatus: "cancelled", confirmationRequired: false };
  }
  if (decision !== "confirm") {
    return { flowStatus: "awaiting_confirmation", confirmationRequired: true, errorCode: "CONFIRMATION_REQUIRED" };
  }
  if (!isTransactionalAiReservationsEnabled(env)) {
    logAiReservationEvent("reservation_booking_gate_blocked", {
      companyId: context.companyId,
      chatbotId: context.chatbotId,
      businessId: context.reservationBusinessId,
      journeyType: flow.journeyType,
      attemptId: flow.bookingAttemptId,
      outcome: "transactional_booking_disabled",
      errorCode: "TRANSACTIONAL_BOOKING_DISABLED",
    });
    return {
      flowStatus: "ready_to_commit",
      confirmationRequired: false,
      errorCode: "TRANSACTIONAL_BOOKING_DISABLED",
      fallbackRequired: true,
      summary: flow.confirmation?.summary || null,
    };
  }
  return {
    flowStatus: "ready_to_commit",
    confirmationRequired: false,
    errorCode: "TRANSACTIONAL_BOOKING_NOT_IMPLEMENTED",
    bookingCreated: false,
    summary: flow.confirmation?.summary || null,
  };
}

export function buildReservationResponse({ reply = "", flowStatus = "idle", journeyType = null, step = null, options = [], summary = null, bookingBehavior = null, confirmationRequired = false, errorCode = null } = {}) {
  return {
    reply,
    reservation: {
      flowStatus,
      journeyType,
      step,
      options,
      confirmationRequired,
      summary,
      bookingBehavior,
      errorCode,
    },
  };
}
