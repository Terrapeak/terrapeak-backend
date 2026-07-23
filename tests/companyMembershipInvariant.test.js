import assert from "node:assert/strict";
import test from "node:test";

import CompanyMembership, {
  normalizeCompanyMembershipUpdate,
  synchronizeCompanyMembershipDocument,
} from "../models/companyMembership.js";

const COMPANY_ID = "64b000000000000000000001";
const USER_ID = "64b000000000000000000002";

const hydratedMembership = (state) =>
  CompanyMembership.hydrate({
    _id: "64b000000000000000000003",
    companyId: COMPANY_ID,
    userId: USER_ID,
    role: "staff",
    ...state,
  });

test("explicitly disabling an active membership makes it inactive", () => {
  const membership = hydratedMembership({
    status: "active",
    isActive: true,
  });

  membership.isActive = false;
  synchronizeCompanyMembershipDocument(membership);

  assert.equal(membership.status, "inactive");
  assert.equal(membership.isActive, false);
});

test("removed memberships cannot be reactivated through isActive", () => {
  const membership = hydratedMembership({
    status: "removed",
    isActive: false,
  });

  membership.isActive = true;
  synchronizeCompanyMembershipDocument(membership);

  assert.equal(membership.status, "removed");
  assert.equal(membership.isActive, false);
});

test("status determines the compatibility isActive field", () => {
  const activeMembership = hydratedMembership({
    status: "inactive",
    isActive: false,
  });
  activeMembership.status = "active";
  synchronizeCompanyMembershipDocument(activeMembership);

  const inactiveMembership = hydratedMembership({
    status: "active",
    isActive: true,
  });
  inactiveMembership.status = "inactive";
  synchronizeCompanyMembershipDocument(inactiveMembership);

  assert.equal(activeMembership.isActive, true);
  assert.equal(inactiveMembership.isActive, false);
});

test("query updates derive isActive from status", () => {
  assert.deepEqual(
    normalizeCompanyMembershipUpdate({ $set: { status: "active" } }),
    { $set: { status: "active", isActive: true } }
  );
  assert.deepEqual(
    normalizeCompanyMembershipUpdate({ status: "removed", isActive: true }),
    { $set: { status: "removed", isActive: false } }
  );
  assert.deepEqual(
    normalizeCompanyMembershipUpdate({ status: "active", isActive: false }),
    { $set: { status: "inactive", isActive: false } }
  );
});

test("query updates cannot write isActive without canonical status", () => {
  assert.throws(
    () => normalizeCompanyMembershipUpdate({ $set: { isActive: false } }),
    /must set status instead of isActive/
  );
});
