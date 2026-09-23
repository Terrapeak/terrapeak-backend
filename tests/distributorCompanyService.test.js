import assert from "node:assert/strict";
import test from "node:test";

import ChatbotSettings from "../models/chatbotSettings.js";
import App from "../models/app.js";
import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import CompanyMembership from "../models/companyMembership.js";
import Contract from "../models/contract.js";
import FacebookChannelConfig from "../models/facebookChannelConfig.js";
import Organization from "../models/organization.js";
import User from "../models/user.js";
import { getCanonicalReservationsReadiness } from "../utils/reservationService.js";
import { reservationProvisioningStore } from "../provisioners/reservationProvisioner.js";
import {
  assertDistributorCompanyAccess,
  cleanupDistributorCompanyCreation,
  createDistributorCompany,
} from "../services/distributorCompanyService.js";

const distributor = { organizationType: "distributor", status: "active", isActive: true };

for (const role of ["owner", "admin"]) {
  test(`Distributor ${role} may create a Customer`, () => {
    assert.doesNotThrow(() =>
      assertDistributorCompanyAccess({
        organization: distributor,
        actorMembership: { role, status: "active" },
      }),
    );
  });
}

for (const role of ["manager", "member", "viewer"]) {
  test(`Distributor ${role} cannot create a Customer`, () => {
    assert.throws(
      () =>
        assertDistributorCompanyAccess({
          organization: distributor,
          actorMembership: { role, status: "active" },
        }),
      (error) => error.code === "ORGANIZATION_ROLE_REQUIRED" && error.statusCode === 403,
    );
  });
}

for (const organizationType of ["direct_customer", "enterprise_group"]) {
  test(`${organizationType} cannot use distributor Customer creation`, () => {
    assert.throws(
      () =>
        assertDistributorCompanyAccess({
          organization: { ...distributor, organizationType },
          actorMembership: { role: "owner", status: "active" },
        }),
      (error) => error.code === "DISTRIBUTOR_ORGANIZATION_REQUIRED",
    );
  });
}

test("inactive Distributor Organizations cannot create a Customer", () => {
  assert.throws(
    () =>
      assertDistributorCompanyAccess({
        organization: { ...distributor, status: "inactive", isActive: false },
        actorMembership: { role: "owner", status: "active" },
      }),
    (error) => error.code === "ORGANIZATION_INACTIVE",
  );
});

test("compensating cleanup attempts every resource and preserves cleanup failures", async (t) => {
  let userDeleted = false;
  t.mock.method(CompanyAppInstallation, "deleteMany", async () => {
    throw new Error("installation cleanup failed");
  });
  for (const model of [
    ChatbotSettings,
    FacebookChannelConfig,
    Contract,
    CompanyMembership,
  ]) {
    t.mock.method(model, "deleteMany", async () => ({ deletedCount: 1 }));
  }
  t.mock.method(Company, "deleteOne", async () => ({ deletedCount: 1 }));
  t.mock.method(User, "deleteOne", async () => {
    userDeleted = true;
    return { deletedCount: 1 };
  });

  const failures = await cleanupDistributorCompanyCreation({
    company: { _id: "company-1" },
    createdUser: { _id: "user-1" },
  });

  assert.equal(userDeleted, true);
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /installation cleanup failed/);
});

test("Distributor creation returns the fresh Company after provisioning changes its version", async (t) => {
  const owner = {
    _id: "user-1",
    name: "Customer Owner",
    email: "owner@example.com",
    phone: "+15550000001",
    platformRole: "none",
    isApproved: true,
    accountStatus: "active",
  };
  const staleCompany = {
    _id: "company-1",
    name: "Customer Company",
    displayName: "Customer Company",
    slug: "customer-company",
    ownerUserId: owner._id,
    organizationId: "organization-1",
    billingSource: "organization",
    installedApps: [],
    save: async () => {
      throw new Error("stale Company save must not run");
    },
  };
  const freshCompany = {
    ...staleCompany,
    installedApps: ["ai-assistant", "reservations"],
  };
  const appQuery = {
    select: () => appQuery,
    lean: async () => [
      { slug: "ai-assistant", isCore: true, dependencies: [] },
      { slug: "reservations", isCore: false, dependencies: [] },
    ],
  };

  t.mock.method(App, "find", () => appQuery);
  t.mock.method(User, "findOne", async () => owner);
  t.mock.method(User, "findById", () => ({
    select: async () => owner,
  }));
  t.mock.method(Company, "findOne", () => ({
    select: () => ({ lean: async () => null }),
  }));
  t.mock.method(Company, "create", async () => staleCompany);
  t.mock.method(Company, "findById", async () => freshCompany);
  t.mock.method(CompanyMembership, "create", async (input) => input);

  const result = await createDistributorCompany({
    organization: {
      _id: "organization-1",
      organizationType: "distributor",
      status: "active",
      isActive: true,
      billingMode: "organization",
      plan: "starter",
      billing: { maxCompanies: null },
    },
    actorMembership: { role: "owner", status: "active" },
    input: {
      company: { name: "Customer Company", slug: "customer-company" },
      owner: { email: owner.email },
      installedApps: ["ai-assistant", "reservations"],
    },
    provisionCompanyFn: async () => ({
      installedApps: ["ai-assistant", "reservations"],
      alreadyInstalledApps: [],
    }),
  });

  assert.deepEqual(result.company.installedApps, ["ai-assistant", "reservations"]);
  assert.equal(result.company, freshCompany);
  assert.equal(result.membership.role, "owner");
});

test("Distributor creation preserves selected Reservations through normalization and response", async (t) => {
  const owner = {
    _id: "user-1",
    name: "Customer Owner",
    email: "owner@example.com",
    phone: "+15550000001",
    platformRole: "none",
  };
  const company = {
    _id: "company-1",
    name: "Customer Company",
    displayName: "Customer Company",
    slug: "customer-company",
    organizationId: "organization-1",
    billingSource: "organization",
    installedApps: [],
  };
  const appQuery = {
    select: () => appQuery,
    lean: async () => [
      { slug: "ai-assistant", isCore: true, dependencies: [] },
      { slug: "reservations", isCore: false, dependencies: [] },
    ],
  };
  let provisioningInput;

  t.mock.method(App, "find", () => appQuery);
  t.mock.method(User, "findOne", async () => owner);
  t.mock.method(Company, "findOne", () => ({
    select: () => ({ lean: async () => null }),
  }));
  t.mock.method(Company, "create", async () => company);
  t.mock.method(Company, "findById", async () => ({
    ...company,
    installedApps: ["ai-assistant", "reservations"],
  }));
  t.mock.method(CompanyMembership, "create", async (input) => input);

  const result = await createDistributorCompany({
    organization: {
      _id: "organization-1",
      organizationType: "distributor",
      status: "active",
      isActive: true,
      billingMode: "organization",
      plan: "enterprise",
      billing: { maxCompanies: null },
    },
    actorMembership: { role: "owner", status: "active" },
    input: {
      company: { name: "Customer Company", slug: "customer-company" },
      owner: { email: owner.email },
      installedApps: ["reservations"],
    },
    provisionCompanyFn: async (input) => {
      provisioningInput = input;
      return {
        installedApps: ["ai-assistant", "reservations"],
        alreadyInstalledApps: [],
      };
    },
  });

  assert.deepEqual(provisioningInput.requestedAppSlugs, ["ai-assistant", "reservations"]);
  assert.deepEqual(result.installedApps, ["ai-assistant", "reservations"]);
  assert.deepEqual(result.company.installedApps, ["ai-assistant", "reservations"]);
});

test("Distributor creation leaves a general Reservations Company ready", async (t) => {
  const companyId = "507f1f77bcf86cd799439011";
  const owner = {
    _id: "507f191e810c19729de860ea",
    name: "Customer Owner",
    email: "owner@example.com",
    phone: "+15550000001",
    platformRole: "none",
  };
  const company = {
    _id: companyId,
    name: "Customer Company",
    displayName: "Customer Company",
    slug: "customer-company",
    organizationId: "507f191e810c19729de860eb",
    billingSource: "organization",
    billing: { status: "not_configured", paymentStatus: "not_configured" },
    plan: "enterprise",
    reservationBusinessSlug: "customer-company",
    reservationTemplate: "general",
    referencePrefix: "CC",
    ownerUserId: owner._id,
    installedApps: [],
    saveCount: 0,
    async save() {
      this.saveCount += 1;
      return this;
    },
  };
  const appQuery = {
    select: () => appQuery,
    lean: async () => [
      { slug: "ai-assistant", isCore: true, dependencies: [] },
      { slug: "reservations", isCore: false, dependencies: [] },
    ],
  };
  const installations = new Map();
  const external = {
    business: { id: 10, business_slug: "customer-company", booking_model_version: 2 },
    profile: { id: "profile-1" },
    reservationSettings: {
      template_key: "general",
      capabilities: { services: true, teamResources: true, scheduledSessions: false, packages: false, guestCount: false },
      terminology: {
        customerSingular: "Customer", customerPlural: "Customers",
        teamMemberSingular: "Team member", teamMemberPlural: "Team members",
        serviceSingular: "Service", servicePlural: "Services",
        bookingSingular: "Booking", bookingPlural: "Bookings",
        guestSingular: "Guest", guestPlural: "Guests",
      },
    },
    service: { id: "service-1" },
    branding: { id: "branding-1" },
  };

  t.mock.method(App, "find", () => appQuery);
  t.mock.method(User, "findOne", async () => null);
  t.mock.method(User, "create", async () => owner);
  t.mock.method(Company, "findOne", () => ({
    select: () => ({ lean: async () => null }),
  }));
  t.mock.method(Company, "create", async () => company);
  t.mock.method(Company, "findById", async () => company);
  t.mock.method(CompanyMembership, "create", async (input) => input);
  t.mock.method(Organization, "findById", () => ({
    lean: async () => ({
      _id: company.organizationId,
      billingMode: "organization",
      plan: "enterprise",
      billing: { status: "active", paymentStatus: "paid" },
    }),
  }));
  t.mock.method(CompanyAppInstallation, "find", () => {
    const query = {
      select: () => query,
      lean: async () => Array.from(installations.values()),
    };
    return query;
  });
  t.mock.method(
    CompanyAppInstallation,
    "findOneAndUpdate",
    async (filter, update) => {
      const installation =
        installations.get(filter.appSlug) || {
          _id: `installation-${filter.appSlug}`,
          companyId: filter.companyId,
          appSlug: filter.appSlug,
          ...update.$setOnInsert,
        };
      Object.assign(installation, update.$set || {});
      installations.set(filter.appSlug, installation);
      return installation;
    },
  );
  t.mock.method(ChatbotSettings, "findOne", async () => null);
  t.mock.method(ChatbotSettings.prototype, "save", async function save() {
    return this;
  });
  t.mock.method(
    reservationProvisioningStore,
    "createOrGetReservationBusiness",
    async () => external.business,
  );
  t.mock.method(
    reservationProvisioningStore,
    "createOrUpdateBusinessProfile",
    async () => external.profile,
  );
  t.mock.method(
    reservationProvisioningStore,
    "createOrUpdateRestaurantSettings",
    async () => {
      throw new Error("General Reservations must not create restaurant settings");
    },
  );
  t.mock.method(
    reservationProvisioningStore,
    "createOrUpdateCanonicalRestaurantService",
    async () => external.service,
  );
  t.mock.method(
    reservationProvisioningStore,
    "createOrUpdateReservationBusinessSettings",
    async () => external.reservationSettings,
  );
  t.mock.method(
    reservationProvisioningStore,
    "activateCanonicalBookingModelIfEmpty",
    async () => ({ business: external.business }),
  );
  t.mock.method(
    reservationProvisioningStore,
    "createOrUpdateRestaurantBranding",
    async () => external.branding,
  );
  t.mock.method(
    reservationProvisioningStore,
    "applyReservationsTemplate",
    async () => ({ templateKey: "general" }),
  );

  const result = await createDistributorCompany({
    organization: {
      _id: company.organizationId,
      organizationType: "distributor",
      status: "active",
      isActive: true,
      billingMode: "organization",
      plan: "enterprise",
      billing: { maxCompanies: null },
    },
    actorMembership: { role: "owner", status: "active" },
    input: {
      company: {
        name: company.name,
        slug: company.slug,
        reservationTemplate: "general",
      },
      owner: { name: owner.name, email: owner.email, phone: owner.phone },
      installedApps: ["reservations"],
    },
    issueInvitationFn: async () => null,
  });

  const installation = installations.get("reservations");
  const readiness = await getCanonicalReservationsReadiness(
    company.reservationBusinessId,
    {
      reservationTemplate: result.company.reservationTemplate,
      store: {
        findReservationBusinessById: async () => ({
          data: external.business,
          error: null,
        }),
        getReservationProvisioningRecords: async () => ({
          profile: external.profile,
          settings: null,
          branding: external.branding,
          reservationSettings: external.reservationSettings,
        }),
      },
    },
  );

  assert.deepEqual(result.installedApps, ["ai-assistant", "reservations"]);
  assert.deepEqual(result.company.installedApps, ["ai-assistant", "reservations"]);
  assert.equal(installation.enabled, true);
  assert.equal(installation.status, "active");
  assert.equal(result.company.reservationBusinessId, 10);
  assert.equal(result.company.reservationBusinessSlug, "customer-company");
  assert.equal(result.company.reservationTemplate, "general");
  assert.deepEqual(readiness, { ready: true, reason: null });
  assert.equal(
    Boolean(
      installation.enabled &&
        result.company.reservationBusinessId &&
        result.company.reservationBusinessSlug &&
        readiness.ready,
    ),
    true,
  );
});
