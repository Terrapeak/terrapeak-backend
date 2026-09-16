import assert from "node:assert/strict";
import test from "node:test";

import ChatbotSettings from "../models/chatbotSettings.js";
import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import CompanyMembership from "../models/companyMembership.js";
import Contract from "../models/contract.js";
import FacebookChannelConfig from "../models/facebookChannelConfig.js";
import User from "../models/user.js";
import {
  assertDistributorCompanyAccess,
  cleanupDistributorCompanyCreation,
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
