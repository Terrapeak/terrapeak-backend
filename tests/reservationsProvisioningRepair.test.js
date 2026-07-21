import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ChatbotSettings from "../models/chatbotSettings.js";
import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import installReservations from "../installers/installReservations.js";
import {
  getReservationsProvisioningHealth,
  reservationProvisioningStore,
} from "../provisioners/reservationProvisioner.js";
import {
  appProvisioningHealthChecks,
  provisionCompany,
} from "../services/companyProvisioningService.js";
import { getMissingReservationFieldValues } from "../utils/reservationService.js";

const COMPANY_ID = "507f1f77bcf86cd799439011";
const OWNER_ID = "507f191e810c19729de860ea";

const createCompany = (overrides = {}) => ({
  _id: COMPANY_ID,
  name: "Terrapeak",
  displayName: "Terrapeak",
  slug: "terrapeak",
  reservationBusinessSlug: "terrapeak",
  referencePrefix: "TP",
  ownerUserId: OWNER_ID,
  installedApps: ["reservations"],
  isPlatformWorkspace: true,
  async save() {
    return this;
  },
  ...overrides,
});

const createMemoryStore = (initial = {}) => {
  const state = {
    business: initial.business || null,
    profile: initial.profile || null,
    settings: initial.settings || null,
    branding: initial.branding || null,
    alternateBusinesses: initial.alternateBusinesses || {},
    creates: { business: 0, profile: 0, settings: 0, branding: 0 },
  };

  return {
    state,
    async findReservationBusinessBySlug(slug) {
      if (state.business?.business_slug === slug) return state.business;
      return state.alternateBusinesses[slug] || null;
    },
    async getReservationProvisioningRecords() {
      return {
        profile: state.profile,
        settings: state.settings,
        branding: state.branding,
      };
    },
    async createOrGetReservationBusiness({ businessName, businessSlug }) {
      if (!state.business) {
        state.creates.business += 1;
        state.business = {
          id: "business-1",
          business_name: businessName,
          business_slug: businessSlug,
          business_type: "restaurant",
        };
      }
      return state.business;
    },
    async createOrUpdateBusinessProfile({ businessId, businessName }) {
      if (!state.profile) {
        state.creates.profile += 1;
        state.profile = {
          id: "profile-1",
          business_id: businessId,
          business_name: businessName,
          booking_label: "Reservation",
        };
      }
      return state.profile;
    },
    async createOrUpdateRestaurantSettings({ businessId }) {
      if (!state.settings) {
        state.creates.settings += 1;
        state.settings = {
          id: "settings-1",
          business_id: businessId,
          opening_time: "11:00:00",
        };
      }
      return state.settings;
    },
    async createOrUpdateRestaurantBranding({ businessId, restaurantName }) {
      if (!state.branding) {
        state.creates.branding += 1;
        state.branding = {
          id: "branding-1",
          business_id: businessId,
          restaurant_name: restaurantName,
        };
      }
      return state.branding;
    },
  };
};

test("active Reservations installation without a Supabase business is unhealthy", async (t) => {
  const company = createCompany();
  t.mock.method(ChatbotSettings, "findOne", async () => ({
    reservationBusinessSlug: "terrapeak",
  }));
  const store = createMemoryStore();

  const health = await getReservationsProvisioningHealth({ company, store });

  assert.equal(health.healthy, false);
  assert.equal(health.companySlug, "terrapeak");
  assert.deepEqual(health.missing, ["businesses"]);
});

test("repeat provisioning creates missing rows once and preserves existing rows", async (t) => {
  const company = createCompany();
  const chatbot = {
    reservationBusinessSlug: "terrapeak",
    async save() {
      throw new Error("Canonical chatbot linkage must not be rewritten");
    },
  };
  t.mock.method(ChatbotSettings, "findOne", async () => chatbot);
  const customProfile = {
    id: "profile-1",
    business_id: "business-1",
    business_name: "Custom Restaurant Name",
    booking_label: "Table booking",
  };
  const store = createMemoryStore({
    business: {
      id: "business-1",
      business_slug: "terrapeak",
      business_name: "Terrapeak",
    },
    profile: customProfile,
  });

  await installReservations({ company, user: { _id: OWNER_ID }, provisioningStore: store });
  await installReservations({ company, user: { _id: OWNER_ID }, provisioningStore: store });

  assert.equal(store.state.profile, customProfile);
  assert.equal(store.state.profile.booking_label, "Table booking");
  assert.deepEqual(store.state.creates, {
    business: 0,
    profile: 0,
    settings: 1,
    branding: 1,
  });
  assert.deepEqual(company.installedApps, ["reservations"]);
});

test("existing customized profile, settings, and branding are reused unchanged", async (t) => {
  const company = createCompany();
  t.mock.method(ChatbotSettings, "findOne", async () => null);
  const customProfile = {
    id: "profile-1",
    business_id: "business-1",
    booking_label: "Private dining",
  };
  const customSettings = {
    id: "settings-1",
    business_id: "business-1",
    opening_time: "06:30:00",
    max_guests_per_slot: 7,
  };
  const customBranding = {
    id: "branding-1",
    business_id: "business-1",
    restaurant_name: "Terrapeak Custom",
    primary_color: "#123456",
  };
  const store = createMemoryStore({
    business: {
      id: "business-1",
      business_slug: "terrapeak",
      business_name: "Terrapeak Custom",
    },
    profile: customProfile,
    settings: customSettings,
    branding: customBranding,
  });

  const result = await installReservations({
    company,
    user: { _id: OWNER_ID },
    provisioningStore: store,
  });

  assert.equal(result.provisioning.profile, customProfile);
  assert.equal(result.provisioning.settings, customSettings);
  assert.equal(result.provisioning.branding, customBranding);
  assert.deepEqual(store.state.creates, {
    business: 0,
    profile: 0,
    settings: 0,
    branding: 0,
  });
});

test("installer initializes the canonical reservation slug from Company.slug", async (t) => {
  const company = createCompany({
    reservationBusinessSlug: "",
    installedApps: [],
  });
  t.mock.method(ChatbotSettings, "findOne", async () => null);
  const store = createMemoryStore();

  await installReservations({
    company,
    user: { _id: OWNER_ID },
    provisioningStore: store,
  });

  assert.equal(company.reservationBusinessSlug, "terrapeak");
  assert.equal(store.state.business.business_slug, "terrapeak");
  assert.deepEqual(company.installedApps, ["reservations"]);
});

test("missing-field defaults do not overwrite customized values", () => {
  const patch = getMissingReservationFieldValues(
    {
      opening_time: "07:30:00",
      closing_time: null,
      max_guests_per_slot: 8,
      default_duration_minutes: 0,
    },
    {
      business_id: "business-1",
      opening_time: "11:00:00",
      closing_time: "22:00:00",
      max_guests_per_slot: 20,
      default_duration_minutes: 90,
    }
  );

  assert.deepEqual(patch, { closing_time: "22:00:00" });
});

test("stale ChatbotSettings slug is repaired to the canonical company slug", async (t) => {
  const company = createCompany();
  let saveCount = 0;
  const chatbot = {
    reservationBusinessSlug: "missing-old-business",
    async save() {
      saveCount += 1;
      return this;
    },
  };
  t.mock.method(ChatbotSettings, "findOne", async () => chatbot);
  const store = createMemoryStore({
    business: { id: "business-1", business_slug: "terrapeak" },
    profile: { id: "profile-1" },
    settings: { id: "settings-1" },
    branding: { id: "branding-1" },
  });

  await installReservations({ company, user: { _id: OWNER_ID }, provisioningStore: store });

  assert.equal(chatbot.reservationBusinessSlug, "terrapeak");
  assert.equal(saveCount, 1);
});

test("a different valid ChatbotSettings business link is preserved", async (t) => {
  const company = createCompany();
  const chatbot = {
    reservationBusinessSlug: "valid-special-business",
    async save() {
      throw new Error("Valid existing linkage must not be overwritten");
    },
  };
  t.mock.method(ChatbotSettings, "findOne", async () => chatbot);
  const store = createMemoryStore({
    business: { id: "business-1", business_slug: "terrapeak" },
    profile: { id: "profile-1" },
    settings: { id: "settings-1" },
    branding: { id: "branding-1" },
    alternateBusinesses: {
      "valid-special-business": {
        id: "business-2",
        business_slug: "valid-special-business",
      },
    },
  });

  const health = await getReservationsProvisioningHealth({ company, store });
  await installReservations({ company, user: { _id: OWNER_ID }, provisioningStore: store });

  assert.equal(health.healthy, true);
  assert.equal(chatbot.reservationBusinessSlug, "valid-special-business");
});

test("platform provisioning repairs active Reservations and synchronizes legacy apps", async (t) => {
  const company = createCompany({ installedApps: [] });
  t.mock.method(Company, "findById", async () => company);
  t.mock.method(CompanyAppInstallation, "find", () => {
    const query = {
      select: () => query,
      lean: async () => [
        { appSlug: "reservations", enabled: true, status: "active" },
      ],
    };
    return query;
  });
  t.mock.method(CompanyAppInstallation, "findOneAndUpdate", async () => ({
    appSlug: "reservations",
    enabled: true,
    status: "active",
  }));
  t.mock.method(
    appProvisioningHealthChecks,
    "reservations",
    async () => ({ healthy: false, missing: ["businesses"], mismatches: [] })
  );
  t.mock.method(ChatbotSettings, "findOne", async () => ({
    reservationBusinessSlug: "terrapeak",
  }));
  const methods = [
    ["createOrGetReservationBusiness", { id: "business-1", business_slug: "terrapeak" }],
    ["createOrUpdateBusinessProfile", { id: "profile-1" }],
    ["createOrUpdateRestaurantSettings", { id: "settings-1" }],
    ["createOrUpdateRestaurantBranding", { id: "branding-1" }],
  ];
  for (const [method, result] of methods) {
    t.mock.method(reservationProvisioningStore, method, async () => result);
  }
  t.mock.method(console, "log", () => {});

  const result = await provisionCompany({
    companyId: COMPANY_ID,
    ownerUserId: OWNER_ID,
    mode: "platform-workspace",
    requestedAppSlugs: ["reservations"],
  });

  assert.deepEqual(result.installedApps, []);
  assert.deepEqual(result.repairedApps, ["reservations"]);
  assert.deepEqual(result.alreadyInstalledApps, []);
  assert.deepEqual(company.installedApps, ["reservations"]);
});

test("frontend error parser accepts the backend message field", () => {
  const source = readFileSync(
    new URL(
      "../../../terrapeak-master/terrapeak-master/src/pages/chatbot/Embed.jsx",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    source,
    /errorBody\.error\s*\|\|\s*errorBody\.message\s*\|\|\s*["']Unknown error["']/
  );
});
