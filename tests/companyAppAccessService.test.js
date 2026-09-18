import test from "node:test";
import assert from "node:assert/strict";
import {
  canEnableCompanyApp,
  resolveEffectiveBilling,
} from "../services/companyAppAccessService.js";
import Organization from "../models/organization.js";

const facebookApp = {
  slug: "facebook",
  isCore: false,
  isComingSoon: false,
  allowInstall: true,
  minimumPlan: "enterprise",
};

const inactiveBilling = {
  status: "not_configured",
};

test("Terrapeak can install or re-enable Facebook without billing or plan access", () => {
  const access = canEnableCompanyApp({
    company: {
      slug: "terrapeak",
      plan: "starter",
      billing: inactiveBilling,
    },
    app: facebookApp,
  });

  assert.deepEqual(access, {
    allowed: true,
    reason: null,
  });
});

test("a regular company with inactive billing remains blocked", () => {
  const access = canEnableCompanyApp({
    company: {
      slug: "customer-company",
      plan: "enterprise",
      billing: inactiveBilling,
    },
    app: facebookApp,
  });

  assert.equal(access.allowed, false);
  assert.match(access.reason, /Billing must be active/);
});

test("a Terrapeak display name does not grant the owner-company exemption", () => {
  const access = canEnableCompanyApp({
    company: {
      slug: "customer-company",
      displayName: "Terrapeak",
      plan: "enterprise",
      billing: inactiveBilling,
    },
    app: facebookApp,
  });

  assert.equal(access.allowed, false);
  assert.match(access.reason, /Billing must be active/);
});

test("Terrapeak remains blocked from apps marked Coming Soon", () => {
  const access = canEnableCompanyApp({
    company: {
      slug: "terrapeak",
      plan: "starter",
      billing: inactiveBilling,
    },
    app: {
      ...facebookApp,
      isComingSoon: true,
    },
  });

  assert.equal(access.allowed, false);
  assert.equal(access.reason, "This app is coming soon.");
});

test("Terrapeak remains blocked when app installation is disabled", () => {
  const access = canEnableCompanyApp({
    company: {
      slug: "terrapeak",
      plan: "starter",
      billing: inactiveBilling,
    },
    app: {
      ...facebookApp,
      allowInstall: false,
    },
  });

  assert.equal(access.allowed, false);
  assert.equal(access.reason, "This app cannot currently be installed.");
});

const reservationsApp = {
  slug: "reservations",
  isCore: false,
  isComingSoon: false,
  allowInstall: true,
  minimumPlan: "starter",
};

const inheritedCompany = {
  billingSource: "organization",
  organizationId: "organization-1",
  plan: "starter",
  billing: { status: "not_configured", paymentStatus: "not_configured" },
};

const mockOrganizationBilling = (t, organization) => {
  t.mock.method(Organization, "findById", () => ({
    lean: async () => organization,
  }));
};

test("Company-local active billing permits Reservations", async () => {
  const effectiveBilling = await resolveEffectiveBilling({
    plan: "starter",
    billingSource: "company",
    billing: { status: "active", paymentStatus: "paid" },
  });
  assert.equal(
    canEnableCompanyApp({ company: {}, app: reservationsApp, effectiveBilling }).allowed,
    true,
  );
});

for (const billingStatus of ["active", "trial"]) {
  test(`Organization-inherited ${billingStatus} billing permits Reservations`, async (t) => {
    mockOrganizationBilling(t, {
      _id: "organization-1",
      name: "Test Companies",
      slug: "test-companies",
      organizationType: "distributor",
      billingMode: "organization",
      plan: "enterprise",
      billing: { status: billingStatus, paymentStatus: "paid" },
    });
    const effectiveBilling = await resolveEffectiveBilling(inheritedCompany);
    assert.equal(
      canEnableCompanyApp({ company: inheritedCompany, app: reservationsApp, effectiveBilling }).allowed,
      true,
    );
  });
}

test("production inherited enterprise billing permits Reservations", async (t) => {
  mockOrganizationBilling(t, {
    _id: "organization-1",
    name: "Test Companies",
    organizationType: "distributor",
    billingMode: "organization",
    plan: "enterprise",
    billing: { status: "active", paymentStatus: "paid" },
  });
  const effectiveBilling = await resolveEffectiveBilling(inheritedCompany);
  assert.equal(
    canEnableCompanyApp({ company: inheritedCompany, app: reservationsApp, effectiveBilling }).allowed,
    true,
  );
});

for (const billing of [
  { status: "not_configured" },
  { status: "cancelled" },
]) {
  test("invalid Organization-inherited billing denies Reservations", async (t) => {
    mockOrganizationBilling(t, {
      _id: "organization-1",
      organizationType: "distributor",
      billingMode: "organization",
      plan: "enterprise",
      billing,
    });
    const effectiveBilling = await resolveEffectiveBilling(inheritedCompany);
    assert.equal(
      canEnableCompanyApp({ company: inheritedCompany, app: reservationsApp, effectiveBilling }).allowed,
      false,
    );
  });
}

test("Organization-inherited plan below the app minimum denies installation", async (t) => {
  mockOrganizationBilling(t, {
    _id: "organization-1",
    organizationType: "distributor",
    billingMode: "organization",
    plan: "starter",
    billing: { status: "active", paymentStatus: "paid" },
  });
  const effectiveBilling = await resolveEffectiveBilling(inheritedCompany);
  assert.equal(
    canEnableCompanyApp({
      company: inheritedCompany,
      app: { ...reservationsApp, minimumPlan: "enterprise" },
      effectiveBilling,
    }).allowed,
    false,
  );
});

test("missing Organization billing context denies inherited installation safely", async (t) => {
  mockOrganizationBilling(t, null);
  const effectiveBilling = await resolveEffectiveBilling(inheritedCompany);
  assert.equal(
    canEnableCompanyApp({ company: inheritedCompany, app: reservationsApp, effectiveBilling }).allowed,
    false,
  );
});
