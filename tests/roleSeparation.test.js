import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANY_MEMBERSHIP_ROLES,
  ORGANIZATION_ROLES,
  PLATFORM_ROLES,
  assertOrganizationRoleAssignment,
  assertPlatformRole,
  isCompanyMembershipRole,
  isOrganizationRole,
  isPlatformRole,
} from "../utils/roleSeparation.js";

test("platform, company, and organization role checks remain separate", () => {
  assert.equal(isPlatformRole("platform-admin"), true);
  assert.equal(isCompanyMembershipRole("platform-admin"), false);
  assert.equal(isOrganizationRole("platform-admin"), false);

  assert.equal(isCompanyMembershipRole("owner"), true);
  assert.equal(isPlatformRole("owner"), false);
  assert.equal(isOrganizationRole("owner"), true);

  assert.equal(isOrganizationRole("member"), true);
  assert.equal(isPlatformRole("member"), false);
  assert.equal(isCompanyMembershipRole("member"), false);
});

test("role helpers keep each role scope independently enumerable", () => {
  assert.deepEqual(PLATFORM_ROLES.includes("platform-admin"), true);
  assert.deepEqual(COMPANY_MEMBERSHIP_ROLES.includes("staff"), true);
  assert.deepEqual(ORGANIZATION_ROLES.includes("member"), true);
});

test("organization-only role names are rejected as platform roles", () => {
  for (const role of ["owner", "admin", "manager", "member"]) {
    assert.throws(
      () => assertPlatformRole(role),
      (error) => error.code === "INVALID_PLATFORM_ROLE"
    );
  }
});

test("platform users cannot receive a future organization role", () => {
  assert.throws(
    () =>
      assertOrganizationRoleAssignment({
        platformRole: "platform-admin",
        organizationRole: "admin",
      }),
    (error) => error.code === "PLATFORM_ORGANIZATION_ROLE_CONFLICT"
  );
});

test("non-platform users can pass future organization role validation", () => {
  assert.equal(
    assertOrganizationRoleAssignment({
      platformRole: "none",
      organizationRole: "member",
    }),
    "member"
  );
});

test("unknown organization roles are rejected", () => {
  assert.throws(
    () =>
      assertOrganizationRoleAssignment({
        platformRole: "none",
        organizationRole: "platform-admin",
      }),
    (error) => error.code === "INVALID_ORGANIZATION_ROLE"
  );
});
