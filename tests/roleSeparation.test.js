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
  assert.equal(isOrganizationRole("owner"), false);

  assert.equal(isOrganizationRole("organization-owner"), true);
  assert.equal(isPlatformRole("organization-owner"), false);
  assert.equal(isCompanyMembershipRole("organization-owner"), false);
});

test("all role namespaces are explicitly disjoint", () => {
  const platformAndOrganization = PLATFORM_ROLES.filter((role) =>
    ORGANIZATION_ROLES.includes(role)
  );
  const companyAndOrganization = COMPANY_MEMBERSHIP_ROLES.filter((role) =>
    ORGANIZATION_ROLES.includes(role)
  );

  assert.deepEqual(platformAndOrganization, []);
  assert.deepEqual(companyAndOrganization, []);
});

test("organization role names are rejected as platform roles", () => {
  for (const role of ORGANIZATION_ROLES) {
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
        organizationRole: "organization-admin",
      }),
    (error) => error.code === "PLATFORM_ORGANIZATION_ROLE_CONFLICT"
  );
});

test("non-platform users can pass future organization role validation", () => {
  assert.equal(
    assertOrganizationRoleAssignment({
      platformRole: "none",
      organizationRole: "organization-member",
    }),
    "organization-member"
  );
});

test("unknown organization roles are rejected", () => {
  assert.throws(
    () =>
      assertOrganizationRoleAssignment({
        platformRole: "none",
        organizationRole: "admin",
      }),
    (error) => error.code === "INVALID_ORGANIZATION_ROLE"
  );
});
