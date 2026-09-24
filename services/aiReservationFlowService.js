import { buildReservationConversationContextSnapshot, isTransactionalAiReservationsEnabled } from "./chatReservationContextService.js";
import { getOrCreateReservationBookingAttempt } from "./reservationBookingAttemptService.js";
import { logAiReservationEvent } from "../utils/aiReservationLogger.js";
import { randomUUID } from "node:crypto";
import { executeAiReservationBooking } from "./aiReservationBookingService.js";
import { fingerprintReservationBookingRequest, fingerprintRestaurantBookingRequest } from "../utils/reservationRequestFingerprint.js";
import { getCustomerCoreFieldKey, serializeCustomerFormAnswers } from "../utils/aiReservationCustomerForm.js";

export const RESERVATION_FLOW_STATES = Object.freeze([
  "idle", "service_selection", "provider_selection", "date_selection",
  "guest_count", "slot_selection", "customer_form", "review", "awaiting_confirmation",
  "ready_to_commit", "completed", "cancelled", "failed",
]);

const confirmationWords = new Set(["confirm", "yes", "yes confirm", "book it", "confirm booking"]);
const negativeWords = new Set(["no", "cancel", "stop", "never mind", "nevermind", "forget it", "cancel this", "cancel booking", "i do not want to book anymore", "i dont want to book anymore", "change time", "go back"]);

const formatLocalTime = (value) => String(value || "").replace(/^(\d{1,2}:\d{2}):\d{2}$/, "$1");

export const resetReservationFlowSelections = (flow = {}, status = "cancelled") => ({
  ...flow,
  status,
  serviceId: null,
  serviceSlug: null,
  serviceName: null,
  providerId: null,
  providerSlug: null,
  providerName: null,
  localDate: null,
  startsAt: null,
  timezone: null,
  selectionOptions: [],
  customer: {},
  customData: {},
  customerFormSnapshot: [],
  formFieldIndex: null,
  currentCustomField: null,
  customFieldIndex: null,
  confirmation: {},
  bookingAttemptId: null,
  idempotencyKey: null,
});

export function initializeReservationFlow({ context, journeyType = "appointment", session }) {
  const flow = {
    version: 1,
    status: journeyType === "restaurant" ? "guest_count" : "service_selection",
    journeyType,
    companyId: context.companyId,
    installationId: context.installationId,
    businessId: String(context.reservationBusinessId),
    businessSlug: context.reservationBusinessSlug,
    templateKey: context.configuration.templateKey,
    timezone: null,
    quantity: journeyType === "restaurant" ? null : 1,
    customer: {},
    customData: {},
    customerFormSnapshot: [],
    displaySnapshot: {},
    confirmation: {},
    bookingAttemptId: randomUUID(),
    idempotencyKey: null,
    contextSnapshot: buildReservationConversationContextSnapshot(context),
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

export const buildReservationConfirmationSummary = ({ context, flow, service, provider, slot, customer, form }) => {
  const common = {
    businessId: context.reservationBusinessId,
    businessSlug: context.reservationBusinessSlug,
    startsAt: slot?.startsAt || flow.startsAt || null,
    endsAt: slot?.endsAt || null,
    localDate: flow.localDate || null,
    localTime: formatLocalTime(slot?.localTime || flow.localTime),
    timezone: slot?.timezone || flow.timezone || null,
    quantity: flow.quantity || 1,
    customer: {
      name: customer?.name || null,
      email: customer?.email || null,
      phone: customer?.phone || null,
    },
    customFields: (Array.isArray(form) ? form : [])
      .filter((field) => !getCustomerCoreFieldKey(field))
      .map((field) => ({ label: field.label, value: flow.customData?.[field.id] }))
      .filter((field) => field.value !== undefined && field.value !== null && field.value !== ""),
    bookingBehavior: context.configuration.bookingBehavior,
    terminology: context.configuration.terminology,
    formFieldCount: Array.isArray(form) ? form.length : 0,
    journeyType: flow?.journeyType || "appointment",
  };
  if (flow?.journeyType === "restaurant") return common;
  return {
    ...common,
    serviceId: service?.id || flow.serviceId || null,
    serviceName: service?.name || null,
    providerId: provider?.id || flow.providerId || null,
    providerName: provider?.displayName || null,
    durationMinutes: provider?.customDurationMinutes || service?.durationMinutes || null,
    price: provider?.customPrice ?? service?.price ?? null,
    currency: service?.currency || null,
  };
};

const summaryValue = (value, fallback = "Not provided") => value === undefined || value === null || value === "" ? fallback : String(value);

export function formatReservationConfirmationSummary(summary = {}) {
  if (summary.journeyType === "restaurant") {
    const blocks = [
      "Reservation summary",
      `Date: ${summaryValue(summary.localDate)}`,
      `Time: ${summaryValue(summary.localTime)}${summary.timezone ? ` (${summary.timezone})` : ""}`,
      `Guests: ${summaryValue(summary.quantity)}`,
      `Customer: ${summaryValue(summary.customer?.name)}`,
      `Email: ${summaryValue(summary.customer?.email)}`,
      `Phone: ${summaryValue(summary.customer?.phone)}`,
    ];
    if (summary.customFields?.length) {
      blocks.push("Additional details:");
      for (const field of summary.customFields) blocks.push(`${field.label}: ${field.value}`);
    }
    blocks.push("Reply **yes** to confirm or **no** to cancel.");
    return blocks.join("\n\n");
  }
  const blocks = [
    "Booking summary",
    `Service: ${summaryValue(summary.serviceName)}`,
    `Provider: ${summaryValue(summary.providerName)}`,
    `Date: ${summaryValue(summary.localDate)}`,
    `Time: ${summaryValue(summary.localTime)}${summary.timezone ? ` (${summary.timezone})` : ""}`,
    `Customer: ${summaryValue(summary.customer?.name)}`,
    `Email: ${summaryValue(summary.customer?.email)}`,
    `Phone: ${summaryValue(summary.customer?.phone)}`,
  ];
  if (summary.customFields?.length) {
    blocks.push("Additional details:");
    for (const field of summary.customFields) blocks.push(`${field.label}: ${field.value}`);
  }
  blocks.push("Reply **yes** to confirm or **no** to cancel.");
  return blocks.join("\n\n");
}

export function formatReservationSuccessResponse(summary = {}, result = {}) {
  const reference = result.reference || result.bookingReference || "not available";
  if (summary.journeyType === "restaurant") {
    const blocks = [
      "Your reservation is confirmed.",
      `Date: ${summaryValue(summary.localDate)}`,
      `Time: ${summaryValue(summary.localTime)}${summary.timezone ? ` (${summary.timezone})` : ""}`,
      `Guests: ${summaryValue(summary.quantity)}`,
      `Reference: ${reference}`,
    ];
    if (result.confirmationEmail?.status === "failed") blocks.push("We couldn't send the confirmation email. Please keep this booking reference.");
    return blocks.join("\n\n");
  }
  const blocks = [
    "Your appointment is confirmed.",
    `Service: ${summaryValue(summary.serviceName)}`,
    `Provider: ${summaryValue(summary.providerName)}`,
    `Date: ${summaryValue(summary.localDate)}`,
    `Time: ${summaryValue(summary.localTime)}${summary.timezone ? ` (${summary.timezone})` : ""}`,
    `Reference: ${reference}`,
  ];
  if (result.confirmationEmail?.status === "failed") {
    blocks.push("We couldn't send the confirmation email. Please keep this booking reference.");
  }
  return blocks.join("\n\n");
}

export async function prepareReservationConfirmation({ context, session, flow, service, provider, slot, customer, form, model }) {
  const summary = buildReservationConfirmationSummary({ context, flow, service, provider, slot, customer, form });
  const bookingAttemptId = flow.bookingAttemptId || randomUUID();
  const canonicalRequest = flow.journeyType === "restaurant"
    ? {
        journeyType: "restaurant",
        reservationBusinessId: context.reservationBusinessId,
        reservationBusinessSlug: context.reservationBusinessSlug,
        localDate: summary.localDate,
        localTime: summary.localTime,
        quantity: summary.quantity,
        customerName: customer?.name,
        customerEmail: customer?.email,
        customerPhone: customer?.phone,
        notes: customer?.notes,
        customData: serializeCustomerFormAnswers(form, flow.customData || {}),
      }
    : {
        reservationBusinessSlug: context.reservationBusinessSlug,
        serviceSlug: service?.slug || flow.serviceSlug,
        providerSlug: provider?.slug || flow.providerSlug,
        startsAt: summary.startsAt,
        customerName: customer?.name,
        customerEmail: customer?.email,
        customerPhone: customer?.phone,
        notes: customer?.notes,
        customData: serializeCustomerFormAnswers(form, flow.customData || {}),
      };
  const { fingerprint } = flow.journeyType === "restaurant"
    ? fingerprintRestaurantBookingRequest(canonicalRequest)
    : fingerprintReservationBookingRequest(canonicalRequest);
  const attempt = await getOrCreateReservationBookingAttempt({
    context,
    journeyType: flow.journeyType || "appointment",
    request: {
      version: 1,
      bookingAttemptId,
      fingerprint,
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

export async function confirmReservationFoundation({
  context,
  session,
  message,
  env = process.env,
  apiKey,
  model,
  readAdapter,
  writeAdapter,
  contextResolver,
}) {
  const flow = session?.reservationFlow;
  if (!flow || flow.status !== "awaiting_confirmation") {
    return { flowStatus: flow?.status || "idle", confirmationRequired: true, errorCode: "CONFIRMATION_REQUIRED" };
  }
  const decision = parseReservationConfirmation(message);
  logAiReservationEvent("reservation_confirmation_received", {
    companyId: context.companyId,
    chatbotId: context.chatbotId,
    businessId: context.reservationBusinessId,
    journeyType: flow.journeyType,
    attemptId: flow.bookingAttemptId,
    flowStatus: flow.status,
    confirmationDecision: decision,
  });
  if (decision === "reject") {
    session.reservationFlow = resetReservationFlowSelections(session.reservationFlow);
    return { flowStatus: "cancelled", confirmationRequired: false };
  }
  if (decision !== "confirm") {
    return { flowStatus: "awaiting_confirmation", confirmationRequired: true, errorCode: "CONFIRMATION_REQUIRED" };
  }
  const transactionalBookingEnabled = isTransactionalAiReservationsEnabled(env);
  logAiReservationEvent("reservation_transaction_gate_checked", {
    companyId: context.companyId,
    chatbotId: context.chatbotId,
    businessId: context.reservationBusinessId,
    journeyType: flow.journeyType,
    attemptId: flow.bookingAttemptId,
    enabled: transactionalBookingEnabled,
  });
  if (!transactionalBookingEnabled) {
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
  try {
    const result = await executeAiReservationBooking({
      context,
      session,
      apiKey,
      model,
      readAdapter,
      writeAdapter,
      contextResolver,
    });
    return {
      ...result,
      confirmationRequired: false,
      summary: flow.confirmation?.summary || null,
    };
  } catch (error) {
    const fallbackRequired = [
      "RESERVATION_JOURNEY_UNSUPPORTED",
      "RESERVATIONS_WRITE_NOT_CONFIGURED",
      "RESERVATIONS_WRITE_REJECTED",
      "RESERVATION_SLOT_UNAVAILABLE",
      "RESERVATION_SLOT_CHANGED",
      "RESERVATION_SERVICE_CHANGED",
      "RESERVATION_PROVIDER_CHANGED",
      "RESERVATION_CUSTOMER_FORM_INVALID",
      "RESERVATION_CONFIGURATION_CHANGED",
      "BOOKING_RESULT_UNKNOWN",
      "BOOKING_IN_PROGRESS",
      "IDEMPOTENCY_REQUEST_CONFLICT",
      "BOOKING_ATTEMPT_CONFLICT",
    ].includes(error.code);
    return {
      flowStatus: session.reservationFlow?.status || "failed",
      confirmationRequired: false,
      errorCode: error.code || "RESERVATIONS_WRITE_FAILED",
      bookingCreated: false,
      fallbackRequired,
      summary: flow.confirmation?.summary || null,
    };
  }
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
