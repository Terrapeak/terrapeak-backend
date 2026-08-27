import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-test-key";

import APP_REGISTRY_DEFINITIONS from "../appRegistryDefinitions.js";
import { getAppManifest } from "../appManifests/index.js";
import requireCompanyApp from "../middleware/requireCompanyApp.js";
import App from "../models/app.js";
import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import ensureDigitalCloneRegistry from "../services/digitalCloneRegistryService.js";

const COMPANY_ID = "507f1f77bcf86cd799439011";
const USER_ID = "507f191e810c19729de860ea";

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

test("Digital Clone is available, installable, and has customer navigation", () => {
  const definition = APP_REGISTRY_DEFINITIONS.find(
    (app) => app.slug === "digital-clone",
  );
  const manifest = getAppManifest("digital-clone");

  assert.equal(definition.category, "business");
  assert.equal(definition.minimumPlan, "starter");
  assert.equal(definition.isVisible, true);
  assert.equal(definition.isComingSoon, false);
  assert.equal(definition.allowInstall, true);
  assert.equal(definition.defaultForCustomer, false);
  assert.equal(manifest.navigation.items[0].path, "/dashboard/digital-clone");
});

test("Digital Clone registry reconciliation repairs an existing registry row", async (t) => {
  let registryUpdate;
  t.mock.method(App, "findOneAndUpdate", async (filter, update, options) => {
    registryUpdate = { filter, update, options };
    return { _id: "digital-clone-app" };
  });

  await ensureDigitalCloneRegistry();

  assert.deepEqual(registryUpdate.filter, { slug: "digital-clone" });
  assert.equal(registryUpdate.update.$set.isVisible, true);
  assert.equal(registryUpdate.update.$set.allowInstall, true);
  assert.equal(registryUpdate.update.$set.isComingSoon, false);
  assert.equal(registryUpdate.update.$set.category, "business");
  assert.equal(registryUpdate.update.$set.minimumPlan, "starter");
  assert.deepEqual(registryUpdate.options, {
    upsert: true,
    new: true,
    runValidators: true,
  });
});

test("platform admin can install, disable, and re-enable Digital Clone", async (t) => {
  const { toggleCompanyApp } = await import(
    "../controllers/platformAdminController.js"
  );
  const company = {
    _id: COMPANY_ID,
    slug: "customer-company",
    plan: "starter",
    billing: { status: "trial" },
    installedApps: [],
    async save() {
      return this;
    },
  };
  const app = {
    _id: "digital-clone-app",
    slug: "digital-clone",
    name: "Digital Clone",
    isCore: false,
    isComingSoon: false,
    allowInstall: true,
    minimumPlan: "starter",
  };
  let installation = null;

  t.mock.method(Company, "findById", () => ({ select: async () => company }));
  t.mock.method(App, "findById", async () => app);
  t.mock.method(CompanyAppInstallation, "findOne", async () => installation);
  t.mock.method(CompanyAppInstallation, "create", async (values) => {
    installation = {
      ...values,
      async save() {
        return this;
      },
    };
    return installation;
  });
  t.mock.method(Company, "updateOne", async () => ({}));

  const toggle = async () => {
    const response = createResponse();
    await toggleCompanyApp(
      {
        params: { companyId: COMPANY_ID, appId: app._id },
        userId: USER_ID,
        platformUser: {
          _id: USER_ID,
          name: "Platform Admin",
          email: "admin@example.com",
        },
      },
      response,
      (error) => {
        throw error;
      },
    );
    return response;
  };

  const installed = await toggle();
  assert.equal(installed.statusCode, 200);
  assert.equal(installation.enabled, true);
  assert.equal(installation.status, "active");
  assert.deepEqual(company.installedApps, ["digital-clone"]);

  const disabled = await toggle();
  assert.equal(disabled.statusCode, 200);
  assert.equal(installation.enabled, false);
  assert.equal(installation.status, "disabled");

  const reEnabled = await toggle();
  assert.equal(reEnabled.statusCode, 200);
  assert.equal(installation.enabled, true);
  assert.equal(installation.status, "active");
  assert.deepEqual(company.installedApps, ["digital-clone"]);
});

test("Digital Clone entitlement passes only for an active installation", async (t) => {
  let storedInstallation = {
    companyId: COMPANY_ID,
    appSlug: "digital-clone",
    enabled: true,
    status: "active",
  };
  const observedFilters = [];

  t.mock.method(CompanyAppInstallation, "findOne", (filter) => ({
    lean: async () => {
      observedFilters.push(filter);
      if (
        storedInstallation?.enabled !== true ||
        storedInstallation?.status === "disabled"
      ) {
        return null;
      }
      return storedInstallation;
    },
  }));

  const middleware = requireCompanyApp("digital-clone");
  const invoke = async () => {
    const request = { company: { _id: COMPANY_ID } };
    const response = createResponse();
    let nextCalled = false;
    await middleware(request, response, (error) => {
      if (error) throw error;
      nextCalled = true;
    });
    return { request, response, nextCalled };
  };

  const active = await invoke();
  assert.equal(active.nextCalled, true);
  assert.equal(active.request.companyAppInstallation, storedInstallation);

  storedInstallation = null;
  const notInstalled = await invoke();
  assert.equal(notInstalled.nextCalled, false);
  assert.equal(notInstalled.response.statusCode, 403);
  assert.equal(notInstalled.response.body.code, "APP_ACCESS_REQUIRED");

  storedInstallation = {
    companyId: COMPANY_ID,
    appSlug: "digital-clone",
    enabled: false,
    status: "disabled",
  };
  const disabled = await invoke();
  assert.equal(disabled.nextCalled, false);
  assert.equal(disabled.response.statusCode, 403);
  assert.equal(disabled.response.body.code, "APP_ACCESS_REQUIRED");

  assert.deepEqual(observedFilters[0], {
    companyId: COMPANY_ID,
    appSlug: "digital-clone",
    enabled: true,
    status: { $ne: "disabled" },
  });
});
