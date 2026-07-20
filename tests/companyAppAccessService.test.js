import test from "node:test";
import assert from "node:assert/strict";
import { canEnableCompanyApp } from "../services/companyAppAccessService.js";

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
