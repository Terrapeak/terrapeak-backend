import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import APP_REGISTRY_DEFINITIONS from "../appRegistryDefinitions.js";
import {
  appProvisioningHealthChecks,
  provisionCompany,
} from "../services/companyProvisioningService.js";
import { onboardCustomerEnvironment } from "../services/customerOnboardingService.js";
import ChatbotSettings from "../models/chatbotSettings.js";
import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import CompanyMembership from "../models/companyMembership.js";
import Contract from "../models/contract.js";
import FacebookChannelConfig from "../models/facebookChannelConfig.js";
import User from "../models/user.js";

const COMPANY_ID = "507f1f77bcf86cd799439011";
const OWNER_ID = "507f191e810c19729de860ea";

const createCompany = (overrides = {}) => ({
  _id: COMPANY_ID,
  name: "Customer Company",
  displayName: "Customer Company",
  slug: "customer-company",
  ownerUserId: OWNER_ID,
  reservationBusinessSlug: "customer-company",
  referencePrefix: "CC",
  plan: "starter",
  billing: { status: "trial" },
  installedApps: [],
  isActive: true,
  isPlatformWorkspace: false,
  saveCount: 0,
  async save() {
    this.saveCount += 1;
    return this;
  },
  ...overrides,
});

const mockCompanyLookup = (t, company) => {
  t.mock.method(Company, "findById", async (companyId) => {
    assert.equal(String(companyId), COMPANY_ID);
    return company;
  });
};

const mockInstallationState = (t, initialRecords = []) => {
  const records = new Map(
    initialRecords.map((record) => [record.appSlug, { ...record }])
  );
  let nextId = 1;

  t.mock.method(CompanyAppInstallation, "find", (filter) => {
    assert.equal(String(filter.companyId), COMPANY_ID);
    const requested = filter.appSlug.$in;
    const query = {
      select: () => query,
      lean: async () =>
        requested.filter((slug) => records.has(slug)).map((slug) => ({
          ...records.get(slug),
        })),
    };
    return query;
  });

  t.mock.method(
    CompanyAppInstallation,
    "findOneAndUpdate",
    async (filter, update) => {
      const slug = filter.appSlug;
      let record = records.get(slug);

      if (!record) {
        record = {
          _id: `installation-${nextId}`,
          ...update.$setOnInsert,
        };
        nextId += 1;
      }

      if (update.$set) Object.assign(record, update.$set);
      records.set(slug, record);
      return record;
    }
  );

  return records;
};

test("customer defaults install AI Assistant and Facebook idempotently", async (t) => {
  const company = createCompany();
  const records = mockInstallationState(t);
  mockCompanyLookup(t, company);
  t.mock.method(console, "log", () => {});

  let chatbotLookupCount = 0;
  let savedChatbot;
  t.mock.method(ChatbotSettings, "findOne", async () => {
    chatbotLookupCount += 1;
    return savedChatbot || null;
  });
  t.mock.method(ChatbotSettings.prototype, "save", async function save() {
    this._id = "chatbot-settings-1";
    savedChatbot = this;
    return this;
  });

  let facebookConfigCount = 0;
  let facebookConfig;
  t.mock.method(
    FacebookChannelConfig,
    "findOneAndUpdate",
    async (filter, update) => {
      facebookConfigCount += 1;
      facebookConfig = facebookConfig || {
        _id: "facebook-config-1",
        companyId: filter.companyId,
        connectionStatus: update.$setOnInsert.connectionStatus,
      };
      facebookConfig.appInstallationId = update.$set.appInstallationId;
      return facebookConfig;
    }
  );

  const first = await provisionCompany({ companyId: COMPANY_ID });
  const second = await provisionCompany({ companyId: COMPANY_ID });

  assert.deepEqual(first.requestedApps, ["ai-assistant", "facebook"]);
  assert.deepEqual(first.installedApps, ["ai-assistant", "facebook"]);
  assert.deepEqual(first.alreadyInstalledApps, []);
  assert.deepEqual(second.installedApps, []);
  assert.deepEqual(second.alreadyInstalledApps, ["ai-assistant", "facebook"]);
  assert.equal(records.size, 2);
  assert.equal(records.get("facebook").enabled, true);
  assert.equal(records.get("facebook").status, "active");
  assert.equal(facebookConfig.connectionStatus, "not_connected");
  assert.equal(facebookConfigCount, 1);
  assert.equal(chatbotLookupCount, 1);
  assert.deepEqual(company.installedApps, ["ai-assistant", "facebook"]);
});

test("customer billing and minimum-plan restrictions remain enforced", async (t) => {
  const company = createCompany({ billing: { status: "not_configured" } });
  mockCompanyLookup(t, company);

  const billingResult = await provisionCompany({
    companyId: COMPANY_ID,
    requestedAppSlugs: ["reservations"],
  });

  assert.deepEqual(billingResult.installedApps, []);
  assert.deepEqual(billingResult.skippedApps, ["reservations"]);
  assert.match(billingResult.warnings[0], /Billing must be active/);

  company.billing.status = "trial";
  const facebookDefinition = APP_REGISTRY_DEFINITIONS.find(
    (definition) => definition.slug === "facebook"
  );
  const originalMinimumPlan = facebookDefinition.minimumPlan;
  facebookDefinition.minimumPlan = "enterprise";

  try {
    const planResult = await provisionCompany({
      companyId: COMPANY_ID,
      requestedAppSlugs: ["facebook"],
    });

    assert.deepEqual(planResult.installedApps, []);
    assert.deepEqual(planResult.skippedApps, ["facebook"]);
    assert.match(planResult.warnings[0], /requires the enterprise plan/);
  } finally {
    facebookDefinition.minimumPlan = originalMinimumPlan;
  }
});

test("customer mode skips coming-soon, unavailable, and unknown apps", async (t) => {
  const company = createCompany();
  mockCompanyLookup(t, company);

  const result = await provisionCompany({
    companyId: COMPANY_ID,
    requestedAppSlugs: ["crm", "whatsapp", "follow-up"],
  });

  assert.deepEqual(result.installedApps, []);
  assert.deepEqual(result.skippedApps, ["crm", "whatsapp", "follow-up"]);
  assert.ok(result.warnings.some((warning) => warning.includes("coming soon")));
  assert.ok(result.warnings.some((warning) => warning.includes("not registered")));
});

test("requesting Facebook expands its AI Assistant dependency", async (t) => {
  const company = createCompany({
    installedApps: ["ai-assistant", "facebook"],
  });
  mockCompanyLookup(t, company);
  mockInstallationState(t, [
    { appSlug: "ai-assistant", enabled: true, status: "active" },
    { appSlug: "facebook", enabled: true, status: "active" },
  ]);

  const result = await provisionCompany({
    companyId: COMPANY_ID,
    requestedAppSlugs: ["facebook"],
  });

  assert.deepEqual(result.requestedApps, ["facebook"]);
  assert.deepEqual(result.alreadyInstalledApps, ["ai-assistant", "facebook"]);
});

test("Platform Workspace mode rejects an ordinary company", async (t) => {
  mockCompanyLookup(t, createCompany());

  await assert.rejects(
    provisionCompany({
      companyId: COMPANY_ID,
      mode: "platform-workspace",
    }),
    /requires the Terrapeak Platform Workspace/
  );
});

test("Platform Workspace mode includes every active technical app and bypasses customer policy", async (t) => {
  const company = createCompany({
    slug: "terrapeak",
    isPlatformWorkspace: true,
    billing: { status: "not_configured" },
  });
  mockCompanyLookup(t, company);
  mockInstallationState(t, [
    { appSlug: "ai-assistant", enabled: true, status: "active" },
    { appSlug: "reservations", enabled: true, status: "active" },
    { appSlug: "facebook", enabled: true, status: "active" },
  ]);
  t.mock.method(
    appProvisioningHealthChecks,
    "reservations",
    async () => ({ healthy: true, missing: [], mismatches: [] })
  );
  t.mock.method(ChatbotSettings, "findOne", async () => {
    throw new Error("Existing ChatbotSettings must not be reset");
  });
  t.mock.method(FacebookChannelConfig, "findOneAndUpdate", async () => {
    throw new Error("Connected Facebook configuration must not be reset");
  });

  const facebookDefinition = APP_REGISTRY_DEFINITIONS.find(
    (definition) => definition.slug === "facebook"
  );
  const originalMinimumPlan = facebookDefinition.minimumPlan;
  facebookDefinition.minimumPlan = "enterprise";

  try {
    const result = await provisionCompany({
      companyId: COMPANY_ID,
      mode: "platform-workspace",
    });

    assert.deepEqual(result.requestedApps, [
      "ai-assistant",
      "reservations",
      "facebook",
    ]);
    assert.deepEqual(result.alreadyInstalledApps, result.requestedApps);
    assert.deepEqual(result.skippedApps, []);
    assert.deepEqual(company.installedApps, result.requestedApps);
    assert.equal(company.saveCount, 1);
  } finally {
    facebookDefinition.minimumPlan = originalMinimumPlan;
  }
});

test("customer onboarding delegates provisioning and fully restores owner membership", async (t) => {
  const company = createCompany();
  const user = {
    _id: OWNER_ID,
    name: "Customer Owner",
    email: "owner@example.com",
    phone: "+60123456789",
    companyName: "Customer Company",
    isApproved: true,
  };
  const membership = {
    _id: "membership-1",
    companyId: COMPANY_ID,
    userId: OWNER_ID,
    role: "owner",
    isActive: true,
    status: "active",
  };
  const chatbot = {
    _id: "chatbot-settings-1",
    companyId: COMPANY_ID,
  };
  let membershipUpdate;

  t.mock.method(User, "findOne", async () => user);
  t.mock.method(Company, "findOne", async () => company);
  mockCompanyLookup(t, company);
  t.mock.method(
    CompanyMembership,
    "findOneAndUpdate",
    async (filter, update) => {
      membershipUpdate = update;
      return membership;
    }
  );
  t.mock.method(Contract, "findOne", async () => ({
    _id: "contract-1",
    companyId: COMPANY_ID,
    status: "trial",
  }));
  mockInstallationState(t, [
    { appSlug: "ai-assistant", enabled: true, status: "active" },
    { appSlug: "facebook", enabled: true, status: "active" },
  ]);
  t.mock.method(ChatbotSettings, "findOne", async () => chatbot);

  const result = await onboardCustomerEnvironment({
    owner: { email: user.email },
    company: { name: company.name },
  });

  assert.equal(result.provisioning.mode, "customer");
  assert.deepEqual(result.installedApps, ["ai-assistant", "facebook"]);
  assert.deepEqual(membershipUpdate.$set, {
    companyId: COMPANY_ID,
    userId: OWNER_ID,
    role: "owner",
    status: "active",
    removedAt: null,
    removedByUserId: null,
  });
});

test("Terrapeak setup delegates platform provisioning without customer onboarding", () => {
  const source = readFileSync(
    new URL("../scripts/setupTerrapeakCompany.js", import.meta.url),
    "utf8"
  );

  assert.match(source, /provisionCompany\s*\(\s*\{/);
  assert.match(source, /mode:\s*["']platform-workspace["']/);
  assert.doesNotMatch(source, /customerOnboardingService/);
  assert.doesNotMatch(source, /onboardCustomerEnvironment/);
});
