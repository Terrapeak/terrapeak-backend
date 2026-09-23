import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  assertReservationSessionBinding,
  buildReservationConversationContextSnapshot,
  getReusableReservationConversationContext,
  isTransactionalAiReservationsEnabled,
  createReservationConfigurationCache,
  resolveChatReservationContext,
} from "../services/chatReservationContextService.js";

const base = {
  _id: "chatbot-1",
  companyId: "company-1",
};
const company = {
  _id: "company-1",
  lifecycleStatus: "active",
  isActive: true,
  reservationBusinessId: 42,
  reservationBusinessSlug: "tenant-a",
  reservationTemplate: "general",
};
const configuration = {
  business_id: 42,
  template_key: "general",
  capabilities: { services: true, teamResources: true },
  terminology: { bookingSingular: "Appointment" },
  booking_behavior: "request",
  confirmation_message: "We received your request.",
};

const store = (overrides = {}) => ({
  findChatbot: async () => base,
  findCompany: async () => company,
  findInstallation: async () => ({ _id: "installation-1", enabled: true, status: "active" }),
  getConfiguration: async () => configuration,
  ...overrides,
});

test("resolves chatbot to its active Company, installation, and canonical business", async () => {
  const context = await resolveChatReservationContext({
    apiKey: "key-a",
    chatbotId: "chatbot-1",
    sessionId: "session-a",
    store: store(),
  });

  assert.equal(context.companyId, "company-1");
  assert.equal(context.reservationBusinessId, 42);
  assert.equal(context.reservationBusinessSlug, "tenant-a");
  assert.equal(context.configuration.templateKey, "general");
  assert.equal(context.configuration.bookingBehavior.booking_behavior, "request");
  assert.equal(context.configuration.terminology.bookingSingular, "Appointment");
});

test("does not accept a client-selected business or use a global fallback", async () => {
  const calls = [];
  const context = await resolveChatReservationContext({
    apiKey: "key-a",
    chatbotId: "chatbot-1",
    sessionId: "session-a",
    reservationBusinessSlug: "dim-sum-dragon",
    store: store({
      getConfiguration: async (slug) => {
        calls.push(slug);
        return configuration;
      },
    }),
  });

  assert.equal(context.reservationBusinessSlug, "tenant-a");
  assert.deepEqual(calls, ["tenant-a"]);
});

test("rejects archived, inactive, and disabled tenants", async (t) => {
  await assert.rejects(
    resolveChatReservationContext({
      apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a",
      store: store({ findCompany: async () => ({ ...company, lifecycleStatus: "archived" }) }),
    }),
    (error) => error.code === "COMPANY_ARCHIVED",
  );
  await assert.rejects(
    resolveChatReservationContext({
      apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a",
      store: store({ findCompany: async () => ({ ...company, isActive: false }) }),
    }),
    (error) => error.code === "COMPANY_INACTIVE",
  );
  await assert.rejects(
    resolveChatReservationContext({
      apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a",
      store: store({ findInstallation: async () => null }),
    }),
    (error) => error.code === "RESERVATIONS_APP_DISABLED",
  );
  t.diagnostic("No database or external Reservations call is made by these tests.");
});

test("rejects a broken Company-to-business mapping and binds later session use", async () => {
  await assert.rejects(
    resolveChatReservationContext({
      apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a",
      store: store({ getConfiguration: async () => ({ ...configuration, business_id: 99 }) }),
    }),
    (error) => error.code === "RESERVATION_TENANT_MISMATCH",
  );
  const context = await resolveChatReservationContext({
    apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a", store: store(),
  });
  assert.doesNotThrow(() => assertReservationSessionBinding({
    companyId: "company-1", businessId: "42", chatbotId: "chatbot-1",
  }, context));
  assert.throws(() => assertReservationSessionBinding({
    companyId: "company-2", businessId: "42", chatbotId: "chatbot-1",
  }, context), (error) => error.code === "RESERVATION_TENANT_MISMATCH");
});

test("transactional booking remains disabled by default", () => {
  assert.equal(isTransactionalAiReservationsEnabled({}), false);
  assert.equal(isTransactionalAiReservationsEnabled({ AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED: "false" }), false);
  assert.equal(isTransactionalAiReservationsEnabled({ AI_RESERVATIONS_TRANSACTIONAL_BOOKING_ENABLED: "true" }), true);
});

test("conversation context snapshots require every authoritative tenant binding", () => {
  const snapshot = buildReservationConversationContextSnapshot({
    sessionId: "session-a",
    chatbotId: "chatbot-1",
    companyId: "company-1",
    reservationBusinessId: 42,
    reservationBusinessSlug: "tenant-a",
    configuration: { templateKey: "general" },
  });
  const current = { sessionId: "session-a", chatbotId: "chatbot-1", companyId: "company-1", reservationBusinessId: 42, reservationBusinessSlug: "tenant-a" };
  assert.ok(getReusableReservationConversationContext({ snapshot, ...current }));
  assert.equal(getReusableReservationConversationContext({ snapshot, ...current, sessionId: "session-b" }), null);
  assert.equal(getReusableReservationConversationContext({ snapshot, ...current, chatbotId: "chatbot-2" }), null);
  assert.equal(getReusableReservationConversationContext({ snapshot, ...current, companyId: "company-2" }), null);
  assert.equal(getReusableReservationConversationContext({ snapshot, ...current, reservationBusinessId: 20 }), null);
  assert.equal(getReusableReservationConversationContext({ snapshot, ...current, reservationBusinessSlug: "tenant-b" }), null);
  assert.equal(getReusableReservationConversationContext({ snapshot, ...current, companyId: undefined }), null);
  assert.equal(getReusableReservationConversationContext({ snapshot, ...current, companyId: "" }), null);
  assert.equal(getReusableReservationConversationContext({ snapshot, ...current, reservationBusinessId: undefined }), null);
  assert.equal(getReusableReservationConversationContext({ snapshot, ...current, reservationBusinessId: "" }), null);
});

test("typed context code contains no global Reservations business fallback", () => {
  const source = readFileSync(new URL("../services/chatReservationContextService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /RESERVATION_BUSINESS_SLUG|dim-sum-dragon/);
});

test("configuration cache uses a bounded 30-second tenant-safe TTL", async () => {
  let now = 0;
  let configurationReads = 0;
  const cache = createReservationConfigurationCache({ now: () => now, maxEntries: 2 });
  const cachedStore = store({
    getConfiguration: async () => {
      configurationReads += 1;
      return configuration;
    },
  });

  await resolveChatReservationContext({ apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a", store: cachedStore, configurationCache: cache });
  await resolveChatReservationContext({ apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-b", store: cachedStore, configurationCache: cache });
  assert.equal(configurationReads, 1);

  now = 30_000;
  await resolveChatReservationContext({ apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-c", store: cachedStore, configurationCache: cache });
  assert.equal(configurationReads, 2);
  assert.equal(cache.size, 1);
});

test("parallel tenant reads preserve company-first error ordering", async () => {
  const companyError = new Error("company read failed");
  const installationError = new Error("installation read failed");
  await assert.rejects(
    resolveChatReservationContext({
      apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a",
      store: store({
        findCompany: async () => { await new Promise((resolve) => setTimeout(resolve, 5)); throw companyError; },
        findInstallation: async () => { throw installationError; },
      }),
    }),
    (error) => error === companyError,
  );
  await assert.rejects(
    resolveChatReservationContext({
      apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a",
      store: store({
        findCompany: async () => null,
        findInstallation: async () => { throw installationError; },
      }),
    }),
    (error) => error.code === "COMPANY_NOT_FOUND",
  );
});

test("configuration cache isolates business identity and slug", async () => {
  let configurationReads = 0;
  const cache = createReservationConfigurationCache();
  const businessA = store({
    getConfiguration: async () => {
      configurationReads += 1;
      return { ...configuration, template_key: "general" };
    },
  });
  const businessB = store({
    findCompany: async () => ({ ...company, _id: "company-2", reservationBusinessId: 99, reservationBusinessSlug: "tenant-b" }),
    getConfiguration: async (slug) => {
      configurationReads += 1;
      return { ...configuration, business_id: 99, template_key: slug === "tenant-b" ? "dental" : "general" };
    },
  });

  const first = await resolveChatReservationContext({ apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a", store: businessA, configurationCache: cache });
  const second = await resolveChatReservationContext({ apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-b", store: businessB, configurationCache: cache });
  assert.equal(first.configuration.templateKey, "general");
  assert.equal(second.configuration.templateKey, "dental");
  assert.equal(configurationReads, 2);
});

test("configuration telemetry distinguishes Supabase misses from cache hits", async () => {
  const cache = createReservationConfigurationCache();
  const events = [];
  const logger = { info: (value) => events.push(JSON.parse(value)) };
  const cachedStore = store();
  await resolveChatReservationContext({ apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a", store: cachedStore, configurationCache: cache, logger });
  await resolveChatReservationContext({ apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-b", store: cachedStore, configurationCache: cache, logger });
  const states = events.filter(({ event }) => event === "reservation_configuration_cache");
  assert.deepEqual(states.map(({ configurationSource, configurationCache }) => [configurationSource, configurationCache]), [
    ["supabase", "miss"],
    ["cache", "hit"],
  ]);
});

test("cache failures fall back to the canonical configuration read", async () => {
  let configurationReads = 0;
  const cache = { get: () => { throw new Error("cache unavailable"); }, set: () => { throw new Error("cache unavailable"); } };
  const context = await resolveChatReservationContext({
    apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a", store: store({
      getConfiguration: async () => {
        configurationReads += 1;
        return configuration;
      },
    }), configurationCache: cache,
  });
  assert.equal(context.reservationBusinessId, 42);
  assert.equal(configurationReads, 1);
});

test("malformed cache entries fall back to the canonical configuration read", async () => {
  let configurationReads = 0;
  const cache = {
    get: () => ({ status: "hit", value: { unexpected: true } }),
    set: () => {},
  };
  await resolveChatReservationContext({
    apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a", configurationCache: cache,
    store: store({
      getConfiguration: async () => {
        configurationReads += 1;
        return configuration;
      },
    }),
  });
  assert.equal(configurationReads, 1);
});

test("final confirmation resolver can explicitly bypass the conversational cache", async () => {
  let configurationReads = 0;
  const cache = createReservationConfigurationCache();
  const cachedStore = store({
    getConfiguration: async () => {
      configurationReads += 1;
      return configuration;
    },
  });
  await resolveChatReservationContext({ apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a", store: cachedStore, configurationCache: cache });
  await resolveChatReservationContext({ apiKey: "key-a", chatbotId: "chatbot-1", sessionId: "session-a", store: cachedStore, configurationCache: cache, bypassConfigurationCache: true });
  assert.equal(configurationReads, 2);
});
