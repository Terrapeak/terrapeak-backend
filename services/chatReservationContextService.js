import ChatbotSettings from "../models/chatbotSettings.js";
import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import { isCompanyOperational } from "../utils/companyLifecycle.js";
import { resolveReservationsConfiguration } from "../utils/reservationConfiguration.js";
import { reservationsReadAdapter } from "./reservationReadAdapter.js";

export class ChatReservationContextError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.name = "ChatReservationContextError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const fail = (code, message, statusCode = 409) => {
  throw new ChatReservationContextError(code, message, statusCode);
};

const asPlainObject = (value) => {
  if (!value) return null;
  return typeof value.toObject === "function" ? value.toObject() : value;
};

const normalizeBusinessId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const normalizeSlug = (value) => {
  const slug = String(value || "").trim().toLowerCase();
  return slug || null;
};

const defaultStore = {
  findChatbot: (apiKey) => ChatbotSettings.findOne({ apiKey }),
  findCompany: (companyId) => Company.findById(companyId),
  findInstallation: (companyId) =>
    CompanyAppInstallation.findOne({
      companyId,
      appSlug: "reservations",
      enabled: true,
      status: "active",
    }),
  getConfiguration: (businessSlug) =>
    reservationsReadAdapter.getConfiguration({ reservationBusinessSlug: businessSlug }),
};

export const normalizeReservationContextConfiguration = (configuration = {}, company = {}) => {
  const resolved = resolveReservationsConfiguration({
    templateKey: configuration.template_key || company.reservationTemplate,
    capabilities: configuration.capabilities,
    terminology: configuration.terminology,
    bookingBehavior: {
      booking_behavior: configuration.booking_behavior,
      confirmation_message: configuration.confirmation_message,
    },
  });

  return {
    templateKey: resolved.templateKey,
    businessType: resolved.businessType,
    capabilities: resolved.capabilities,
    terminology: resolved.terminology,
    bookingBehavior: resolved.bookingBehavior,
  };
};

export async function resolveChatReservationContext({
  apiKey,
  chatbotId,
  sessionId,
  configuration,
  store = defaultStore,
} = {}) {
  if (!apiKey || !chatbotId || !sessionId) {
    fail("RESERVATION_CONTEXT_INVALID", "Reservation context is incomplete.", 400);
  }

  const settings = asPlainObject(await store.findChatbot(apiKey));
  if (!settings) fail("INVALID_CHATBOT_API_KEY", "Invalid chatbot API key.", 403);
  if (String(settings._id) !== String(chatbotId)) {
    fail("INVALID_CHATBOT_ID", "Invalid chatbot ID.", 400);
  }
  if (settings.reservationEnabled === false) {
    fail("RESERVATIONS_APP_DISABLED", "Reservations are not enabled for this chatbot.");
  }

  const companyId = settings.companyId;
  if (!companyId) {
    fail("RESERVATIONS_NOT_CONFIGURED", "Reservations are not configured for this business.");
  }

  const company = asPlainObject(await store.findCompany(companyId));
  if (!company) fail("COMPANY_NOT_FOUND", "The Company could not be found.", 404);
  if (company.lifecycleStatus === "archived") {
    fail("COMPANY_ARCHIVED", "This Company is archived.");
  }
  if (!isCompanyOperational(company)) {
    fail("COMPANY_INACTIVE", "This Company is inactive.");
  }

  const installation = asPlainObject(await store.findInstallation(company._id || companyId));
  if (!installation) {
    fail("RESERVATIONS_APP_DISABLED", "Reservations are not enabled for this Company.");
  }

  const businessId = normalizeBusinessId(company.reservationBusinessId);
  const businessSlug = normalizeSlug(company.reservationBusinessSlug);
  if (!businessId || !businessSlug) {
    fail("RESERVATIONS_NOT_CONFIGURED", "Reservations are not configured for this business.");
  }

  const canonicalConfiguration = configuration || (await store.getConfiguration?.(businessSlug));
  if (!canonicalConfiguration) {
    fail("RESERVATIONS_NOT_CONFIGURED", "Reservations configuration is not ready.");
  }
  if (
    canonicalConfiguration.business_id !== undefined &&
    normalizeBusinessId(canonicalConfiguration.business_id) !== businessId
  ) {
    fail("RESERVATION_TENANT_MISMATCH", "The Reservations business does not match the Company.");
  }

  return Object.freeze({
    sessionId: String(sessionId),
    chatbotId: String(chatbotId),
    companyId: String(company._id || companyId),
    installationId: String(installation._id || installation.id || ""),
    reservationBusinessId: businessId,
    reservationBusinessSlug: businessSlug,
    companyLifecycleStatus: company.lifecycleStatus || "active",
    reservationTemplate: company.reservationTemplate || "general",
    configuration: normalizeReservationContextConfiguration(canonicalConfiguration, company),
  });
}

export const buildReservationConversationContextSnapshot = (context = {}) => ({
  sessionId: String(context.sessionId || ""),
  chatbotId: String(context.chatbotId || ""),
  companyId: String(context.companyId || ""),
  installationId: String(context.installationId || ""),
  reservationBusinessId: context.reservationBusinessId,
  reservationBusinessSlug: context.reservationBusinessSlug,
  companyLifecycleStatus: context.companyLifecycleStatus || "active",
  reservationTemplate: context.reservationTemplate || "general",
  configuration: context.configuration,
});

export const getReusableReservationConversationContext = ({ snapshot, sessionId, chatbotId } = {}) => {
  if (!snapshot || String(snapshot.sessionId || "") !== String(sessionId || "")) return null;
  if (String(snapshot.chatbotId || "") !== String(chatbotId || "")) return null;
  return snapshot;
};

export function assertReservationSessionBinding(flow, context) {
  if (!flow) return;
  const fields = [
    ["companyId", context.companyId],
    ["businessId", String(context.reservationBusinessId)],
    ["chatbotId", context.chatbotId],
  ];
  for (const [field, expected] of fields) {
    if (flow[field] !== undefined && flow[field] !== null && String(flow[field]) !== String(expected)) {
      fail("RESERVATION_TENANT_MISMATCH", "The reservation session is bound to another tenant.");
    }
  }
}

export const isTransactionalAiReservationsEnabled = (env = process.env) =>
  String(env.AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED || "").toLowerCase() === "true";
