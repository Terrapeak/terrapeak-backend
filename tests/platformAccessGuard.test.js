import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_ORGANIZATION_MEMBERSHIP_CONFLICT,
  applyPlatformAccessMutation,
  assertPlatformAccessAssignmentAllowed,
  extractPlatformAccessUpdate,
} from "../utils/platformAccessGuard.js";

const USER_ID = "64b000000000000000000001";

const membershipModel = (conflict) => ({
  exists: async (filter) => {
    assert.equal(filter.status, "active");
    return conflict ? { _id: "64b000000000000000000002" } : null;
  },
});

for (const role of ["owner", "admin", "manager", "member", "viewer"]) {
  test(`active ${role} membership blocks platform promotion`, async () => {
    await assert.rejects(
      assertPlatformAccessAssignmentAllowed({
        userId: USER_ID,
        platformRole: "platform-admin",
        OrganizationMembershipModel: membershipModel(true),
      }),
      (error) =>
        error.code === ACTIVE_ORGANIZATION_MEMBERSHIP_CONFLICT &&
        error.statusCode === 409
    );
  });
}

test("inactive or removed memberships do not block platform promotion", async () => {
  for (const status of ["inactive", "removed"]) {
    let activeFilterUsed = false;
    await assertPlatformAccessAssignmentAllowed({
      userId: USER_ID,
      platformRole: "platform-admin",
      OrganizationMembershipModel: {
        exists: async (filter) => {
          activeFilterUsed = filter.status === "active";
          return null;
        },
      },
    });
    assert.equal(activeFilterUsed, true, status);
  }
});

test("platformRole none remains allowed without a membership lookup", async () => {
  let lookupCalled = false;
  await assertPlatformAccessAssignmentAllowed({
    userId: USER_ID,
    platformRole: "none",
    isAdmin: false,
    OrganizationMembershipModel: {
      exists: async () => {
        lookupCalled = true;
        return true;
      },
    },
  });
  assert.equal(lookupCalled, false);
});

test("legacy isAdmin promotion is blocked", async () => {
  await assert.rejects(
    assertPlatformAccessAssignmentAllowed({
      userId: USER_ID,
      platformRole: "none",
      isAdmin: true,
      OrganizationMembershipModel: membershipModel(true),
    }),
    { code: ACTIVE_ORGANIZATION_MEMBERSHIP_CONFLICT }
  );
});

test("failed indirect promotion leaves the user unchanged", async () => {
  const user = {
    _id: USER_ID,
    platformRole: "none",
    isAdmin: false,
    role: "user",
  };

  await assert.rejects(
    applyPlatformAccessMutation({
      user,
      updates: {
        platformRole: "platform-owner",
        isAdmin: true,
        role: "admin",
      },
      OrganizationMembershipModel: membershipModel(true),
    }),
    { code: ACTIVE_ORGANIZATION_MEMBERSHIP_CONFLICT }
  );

  assert.deepEqual(user, {
    _id: USER_ID,
    platformRole: "none",
    isAdmin: false,
    role: "user",
  });
});

test("stale and operator-based access mutations are recognized", () => {
  assert.deepEqual(
    extractPlatformAccessUpdate({
      $set: { platformRole: "platform-admin" },
      $setOnInsert: { isAdmin: true },
    }),
    {
      touchesPlatformRole: true,
      touchesIsAdmin: true,
      platformRole: "platform-admin",
      isAdmin: true,
    }
  );
});
