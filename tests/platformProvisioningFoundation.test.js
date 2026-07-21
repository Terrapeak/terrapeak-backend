import test from "node:test";
import assert from "node:assert/strict";
import APP_REGISTRY_DEFINITIONS from "../appRegistryDefinitions.js";
import { getAllAppManifests } from "../appManifests/index.js";
import installApps, { getInstallerSlugs } from "../installers/installApps.js";
import { toggleCompanyApp } from "../controllers/platformAdminController.js";
import App from "../models/app.js";
import ChatbotSettings from "../models/chatbotSettings.js";
import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import FacebookChannelConfig from "../models/facebookChannelConfig.js";

const COMPANY_ID = "507f1f77bcf86cd799439011";
const USER_ID = "507f191e810c19729de860ea";
const INSTALLATION_ID = "507f191e810c19729de860eb";
const OWNER_ID = "507f191e810c19729de860ec";

const createCompany = (installedApps = []) => ({
  _id: COMPANY_ID,
  slug: "customer-company",
  displayName: "Customer Company",
  reservationBusinessSlug: "customer-company",
  referencePrefix: "CC",
  plan: "enterprise",
  billing: { status: "trial" },
  ownerUserId: OWNER_ID,
  installedApps: [...installedApps],
  saveCount: 0,
  async save() {
    this.saveCount += 1;
    return this;
  },
});

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const mockInstallationLifecycle = (t, appSlug) => {
  const pendingInstallation = {
    _id: INSTALLATION_ID,
    companyId: COMPANY_ID,
    appSlug,
    enabled: false,
    status: "pending",
  };
  const activeInstallation = {
    ...pendingInstallation,
    enabled: true,
    status: "active",
  };
  const updates = [];

  t.mock.method(
    CompanyAppInstallation,
    "findOneAndUpdate",
    async (filter, update, options) => {
      assert.deepEqual(filter, { companyId: COMPANY_ID, appSlug });
      updates.push({ update, options });
      return updates.length === 1 ? pendingInstallation : activeInstallation;
    }
  );

  return { pendingInstallation, activeInstallation, updates };
};

const invokeEnable = async ({ t, app, company, activeInstallation }) => {
  let installationLookupCount = 0;

  t.mock.method(Company, "findById", (companyId) => {
    assert.equal(companyId, COMPANY_ID);
    return {
      select: async () => company,
    };
  });
  t.mock.method(App, "findById", async () => app);
  t.mock.method(CompanyAppInstallation, "findOne", async (filter) => {
    assert.deepEqual(filter, { companyId: COMPANY_ID, appSlug: app.slug });
    installationLookupCount += 1;
    return installationLookupCount === 1 ? null : activeInstallation;
  });
  t.mock.method(Company, "updateOne", async () => ({}));

  const response = createResponse();
  await toggleCompanyApp(
    {
      params: { companyId: COMPANY_ID, appId: "app-1" },
      userId: USER_ID,
      platformUser: {
        _id: USER_ID,
        name: "Platform Owner",
        email: "owner@example.com",
      },
    },
    response,
    (error) => {
      throw error;
    }
  );

  return response;
};

test("active registry apps, manifests, and installers use the same slugs", () => {
  const registrySlugs = APP_REGISTRY_DEFINITIONS.map((app) => app.slug);
  const activeRegistrySlugs = APP_REGISTRY_DEFINITIONS.filter(
    (app) => !app.isComingSoon && app.allowInstall !== false
  )
    .map((app) => app.slug)
    .sort();
  const manifestSlugs = Object.keys(getAllAppManifests()).sort();
  const installerSlugs = getInstallerSlugs().sort();

  assert.ok(registrySlugs.includes("facebook"));
  assert.deepEqual(activeRegistrySlugs, [
    "ai-assistant",
    "facebook",
    "reservations",
  ]);
  assert.deepEqual(manifestSlugs, activeRegistrySlugs);
  assert.deepEqual(installerSlugs, activeRegistrySlugs);
});

test("enabling Facebook provisions and links its configuration", async (t) => {
  const company = createCompany();
  const { activeInstallation, updates } = mockInstallationLifecycle(
    t,
    "facebook"
  );
  let facebookUpdate;

  t.mock.method(
    FacebookChannelConfig,
    "findOneAndUpdate",
    async (filter, update, options) => {
      assert.deepEqual(filter, { companyId: COMPANY_ID });
      facebookUpdate = update;
      assert.equal(options.upsert, true);
      return {
        companyId: COMPANY_ID,
        appInstallationId: INSTALLATION_ID,
        connectionStatus: "not_connected",
      };
    }
  );

  const response = await invokeEnable({
    t,
    company,
    activeInstallation,
    app: {
      slug: "facebook",
      name: "Facebook",
      isCore: false,
      isComingSoon: false,
      allowInstall: true,
      minimumPlan: "enterprise",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.installation, activeInstallation);
  assert.equal(facebookUpdate.$set.appInstallationId, INSTALLATION_ID);
  assert.equal(facebookUpdate.$setOnInsert.connectionStatus, "not_connected");
  assert.equal(updates.length, 2);
  assert.equal(updates[0].update.$setOnInsert.status, "pending");
  assert.deepEqual(updates[1].update.$set, {
    enabled: true,
    status: "active",
    installedBy: USER_ID,
  });
  assert.deepEqual(company.installedApps, ["facebook"]);
  assert.equal(company.saveCount, 1);
});

test("enabling AI Assistant provisions ChatbotSettings", async (t) => {
  const company = createCompany();
  const { activeInstallation } = mockInstallationLifecycle(t, "ai-assistant");
  let savedSettings;

  t.mock.method(ChatbotSettings, "findOne", async (filter) => {
    assert.deepEqual(filter, { companyId: COMPANY_ID });
    return null;
  });
  t.mock.method(ChatbotSettings.prototype, "save", async function save() {
    this._id = "chatbot-settings-1";
    savedSettings = this;
    return this;
  });

  const response = await invokeEnable({
    t,
    company,
    activeInstallation,
    app: {
      slug: "ai-assistant",
      name: "AI Assistant",
      isCore: true,
      isComingSoon: false,
      allowInstall: true,
      minimumPlan: "starter",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(savedSettings.companyId.toString(), COMPANY_ID);
  assert.equal(savedSettings.userId.toString(), OWNER_ID);
  assert.equal(savedSettings.brandName, "Customer Company");
  assert.deepEqual(company.installedApps, ["ai-assistant"]);
});

test("existing AI Assistant configuration is reused", async (t) => {
  const company = createCompany(["ai-assistant"]);
  const existingSettings = {
    _id: "chatbot-settings-1",
    companyId: COMPANY_ID,
  };
  mockInstallationLifecycle(t, "ai-assistant");
  t.mock.method(ChatbotSettings, "findOne", async () => existingSettings);
  t.mock.method(ChatbotSettings.prototype, "save", async () => {
    throw new Error("Existing ChatbotSettings must not be saved again");
  });

  const result = await installApps({
    company,
    user: { _id: USER_ID },
    installedApps: ["ai-assistant"],
  });

  assert.equal(result["ai-assistant"], existingSettings);
  assert.equal(company.saveCount, 0);
});

test("existing connected Facebook configuration is reused without reset", async (t) => {
  const company = createCompany(["facebook"]);
  const existingConfig = {
    _id: "facebook-config-1",
    companyId: COMPANY_ID,
    connectionStatus: "connected",
    pageId: "page-1",
  };
  mockInstallationLifecycle(t, "facebook");

  t.mock.method(
    FacebookChannelConfig,
    "findOneAndUpdate",
    async (filter, update) => {
      assert.deepEqual(filter, { companyId: COMPANY_ID });
      assert.deepEqual(update.$set, { appInstallationId: INSTALLATION_ID });
      assert.equal(update.$setOnInsert.connectionStatus, "not_connected");
      assert.equal(update.$set.connectionStatus, undefined);
      return existingConfig;
    }
  );

  const result = await installApps({
    company,
    user: { _id: USER_ID },
    installedApps: ["facebook"],
  });

  assert.equal(result.facebook, existingConfig);
  assert.equal(existingConfig.connectionStatus, "connected");
  assert.equal(existingConfig.pageId, "page-1");
  assert.equal(company.saveCount, 0);
});
