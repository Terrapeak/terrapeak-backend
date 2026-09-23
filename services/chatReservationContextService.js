import ChatbotSettings from "../models/chatbotSettings.js";
import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import { isCompanyOperational } from "../utils/companyLifecycle.js";
import {
  buildReservationGovernanceContract,
  resolveReservationsConfiguration,
} from "../utils/reservationConfiguration.js";
import { reservationsReadAdapter } from "./reservationReadAdapter.js";
import { isReservationsTemplate } from "../config/reservationsTemplates.js";
import { logAiReservationEvent, measureAiReservationStage } from "../utils/aiReservationLogger.js";

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

export const RESERVATION_CONFIGURATION_CACHE_TTL_MS = 30_000;
export const RESERVATION_CONFIGURATION_CACHE_MAX_ENTRIES = 100;

export const createReservationConfigurationCache = ({
  ttlMs = RESERVATION_CONFIGURATION_CACHE_TTL_MS,
  maxEntries = RESERVATION_CONFIGURATION_CACHE_MAX_ENTRIES,
  now = () => Date.now(),
} = {}) => {
  const entries = new Map();

  const pruneExpired = (currentTime) => {
    for (const [key, entry] of entries) {
      if (!entry || entry.expiresAt <= currentTime) entries.delete(key);
    }
  };

  return {
    get(key) {
      const currentTime = now();
      const entry = entries.get(key);
      if (!entry) return { status: "miss", value: null };
      if (entry.expiresAt <= currentTime) {
        entries.delete(key);
        pruneExpired(currentTime);
        return { status: "expired", value: null };
      }
      pruneExpired(currentTime);
      entries.delete(key);
      entries.set(key, entry);
      return { status: "hit", value: entry.value };
    },
    set(key, value) {
      const currentTime = now();
      pruneExpired(currentTime);
      if (entries.has(key)) entries.delete(key);
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entries.set(key, { value, expiresAt: currentTime + ttlMs });
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
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

const defaultConfigurationCache = createReservationConfigurationCache();

const configurationCacheKey = ({ companyId, reservationBusinessId, reservationBusinessSlug, reservationTemplate }) =>
  [companyId, reservationBusinessId, reservationBusinessSlug, reservationTemplate || "legacy"].map(String).join(":");

const logConfigurationCacheState = (configurationCache, configurationSource, logger = console) => {
  logAiReservationEvent("reservation_configuration_cache", {
    configurationSource,
    configurationCache,
  }, logger);
};

export const normalizeReservationContextConfiguration = (configuration = {}, company = {}) => {
  const platformTemplate = isReservationsTemplate(company.reservationTemplate)
    ? company.reservationTemplate
    : null;
  const resolved = resolveReservationsConfiguration({
    templateKey: platformTemplate || configuration.template_key || company.reservationTemplate,
    capabilities: configuration.capabilities,
    terminology: configuration.terminology,
    bookingBehavior: {
      booking_behavior: configuration.booking_behavior,
      confirmation_message: configuration.confirmation_message,
    },
    platformAuthoritative: Boolean(platformTemplate),
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
  onResolved,
  configurationCache,
  bypassConfigurationCache = false,
  logger = console,
} = {}) {
  if (!apiKey || !chatbotId || !sessionId) {
    fail("RESERVATION_CONTEXT_INVALID", "Reservation context is incomplete.", 400);
  }

  const settings = asPlainObject(await measureAiReservationStage({
    stage: "context_chatbot_read",
    operation: "mongo_context_chatbot_read",
  }, () => store.findChatbot(apiKey)));
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

  const readWithError = (promise) => promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  const [companyRead, installationRead] = await Promise.all([
    readWithError(measureAiReservationStage({
      stage: "context_company_read",
      operation: "mongo_context_company_read",
    }, () => store.findCompany(companyId))),
    readWithError(measureAiReservationStage({
      stage: "context_installation_read",
      operation: "mongo_context_installation_read",
    }, () => store.findInstallation(companyId))),
  ]);
  if (companyRead.error) throw companyRead.error;
  const companyResult = companyRead.value;
  const company = asPlainObject(companyResult);
  if (!company) fail("COMPANY_NOT_FOUND", "The Company could not be found.", 404);
  if (company.lifecycleStatus === "archived") {
    fail("COMPANY_ARCHIVED", "This Company is archived.");
  }
  if (!isCompanyOperational(company)) {
    fail("COMPANY_INACTIVE", "This Company is inactive.");
  }

  if (installationRead.error) throw installationRead.error;
  const installationResult = installationRead.value;
  const installation = asPlainObject(installationResult);
  if (!installation) {
    fail("RESERVATIONS_APP_DISABLED", "Reservations are not enabled for this Company.");
  }

  const businessId = normalizeBusinessId(company.reservationBusinessId);
  const businessSlug = normalizeSlug(company.reservationBusinessSlug);
  if (!businessId || !businessSlug) {
    fail("RESERVATIONS_NOT_CONFIGURED", "Reservations are not configured for this business.");
  }

  const cache = configurationCache === undefined
    ? (store === defaultStore ? defaultConfigurationCache : null)
    : configurationCache;
  const cacheKey = configurationCacheKey({
    companyId: company._id || companyId,
    reservationBusinessId: businessId,
    reservationBusinessSlug: businessSlug,
    reservationTemplate: isReservationsTemplate(company.reservationTemplate)
      ? company.reservationTemplate
      : null,
  });
  let configurationSource = "provided";
  let configurationCacheState = "bypass";
  let canonicalConfiguration = configuration;
  if (!canonicalConfiguration && !bypassConfigurationCache && cache) {
    let cached;
    configurationCacheState = "miss";
    await measureAiReservationStage({
      stage: "configuration_cache_lookup",
      operation: "reservation_configuration_cache",
      logger,
    }, async () => {
      try {
        cached = cache.get(cacheKey);
        configurationCacheState = ["hit", "expired"].includes(cached?.status) ? cached.status : "miss";
      } catch {
        configurationCacheState = "miss";
      }
    });
    const cachedConfiguration = cached?.value;
    const validCachedConfiguration = cached?.status === "hit"
      && cachedConfiguration
      && typeof cachedConfiguration === "object"
      && typeof cachedConfiguration.templateKey === "string"
      && cachedConfiguration.capabilities
      && cachedConfiguration.terminology
      && cachedConfiguration.bookingBehavior;
    if (validCachedConfiguration) {
      canonicalConfiguration = cachedConfiguration;
      configurationSource = "cache";
      logConfigurationCacheState(configurationCacheState, configurationSource, logger);
    } else if (cached?.status === "hit") {
      configurationCacheState = "miss";
    }
  }
  if (!canonicalConfiguration) {
    canonicalConfiguration = await store.getConfiguration?.(businessSlug);
    configurationSource = "supabase";
    if (configurationCacheState === "miss" || configurationCacheState === "bypass") {
      logConfigurationCacheState(configurationCacheState, configurationSource, logger);
    }
  }
  if (!canonicalConfiguration) {
    fail("RESERVATIONS_NOT_CONFIGURED", "Reservations configuration is not ready.");
  }
  if (
    canonicalConfiguration.business_id !== undefined &&
    normalizeBusinessId(canonicalConfiguration.business_id) !== businessId
  ) {
    fail("RESERVATION_TENANT_MISMATCH", "The Reservations business does not match the Company.");
  }

  const governanceSettings = configurationSource === "cache"
    ? {
        template_key: canonicalConfiguration.templateKey,
        capabilities: canonicalConfiguration.capabilities,
        terminology: canonicalConfiguration.terminology,
        booking_behavior: canonicalConfiguration.bookingBehavior?.booking_behavior,
        confirmation_message: canonicalConfiguration.bookingBehavior?.confirmation_message,
      }
    : canonicalConfiguration;
  const governance = buildReservationGovernanceContract({ company, settings: governanceSettings });

  if (configurationSource === "supabase" && cache && !bypassConfigurationCache) {
    try {
      cache.set(cacheKey, normalizeReservationContextConfiguration(canonicalConfiguration, company));
    } catch {
      // Cache mechanics are best-effort; the canonical configuration remains authoritative.
    }
  }

  const context = Object.freeze({
    sessionId: String(sessionId),
    chatbotId: String(chatbotId),
    companyId: String(company._id || companyId),
    installationId: String(installation._id || installation.id || ""),
    reservationBusinessId: businessId,
    reservationBusinessSlug: businessSlug,
    companyLifecycleStatus: company.lifecycleStatus || "active",
    reservationTemplate: company.reservationTemplate || "general",
    configuration: configurationSource === "cache"
      ? canonicalConfiguration
      : normalizeReservationContextConfiguration(canonicalConfiguration, company),
    ...governance,
  });
  onResolved?.({ settings, company, installation });
  return context;
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
  ...(context.templateAuthority !== undefined
    ? {
        templateAuthority: context.templateAuthority,
        capabilitiesManagedByPlatform: context.capabilitiesManagedByPlatform,
        effectiveTemplateKey: context.effectiveTemplateKey,
        effectiveTemplateLabel: context.effectiveTemplateLabel,
        effectiveCapabilities: context.effectiveCapabilities,
        effectiveTerminology: context.effectiveTerminology,
        bookingBehavior: context.bookingBehavior,
        confirmationMessage: context.confirmationMessage,
      }
    : {}),
});

export const getReusableReservationConversationContext = ({
  snapshot,
  sessionId,
  chatbotId,
  companyId,
  reservationBusinessId,
  reservationBusinessSlug,
} = {}) => {
  if (!snapshot) return null;
  const hasBinding = (value) => value !== undefined && value !== null && String(value).trim() !== "";
  const bindings = [
    [snapshot.sessionId, sessionId],
    [snapshot.chatbotId, chatbotId],
    [snapshot.companyId, companyId],
    [snapshot.reservationBusinessId, reservationBusinessId],
  ];
  if (bindings.some(([cached, current]) => !hasBinding(cached) || !hasBinding(current) || String(cached) !== String(current))) return null;
  if (hasBinding(reservationBusinessSlug)) {
    if (!hasBinding(snapshot.reservationBusinessSlug) || String(snapshot.reservationBusinessSlug) !== String(reservationBusinessSlug)) return null;
  }
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
