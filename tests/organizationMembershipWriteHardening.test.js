import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeOrganizationMembershipUpdate,
  validateOrganizationMembershipQueryMutation,
} from "../models/organizationMembership.js";

const ORGANIZATION_ID = "64b000000000000000000001";
const USER_ID = "64b000000000000000000002";
const MEMBERSHIP_ID = "64b000000000000000000003";

const currentMembership = (overrides = {}) => ({
  _id: MEMBERSHIP_ID,
  organizationId: ORGANIZATION_ID,
  userId: USER_ID,
  role: "member",
  status: "active",
  ...overrides,
});

const dependencies = ({
  user = { _id: USER_ID, platformRole: "none" },
  replacementOwner = { _id: "64b000000000000000000004" },
} = {}) => ({
  OrganizationModel: {
    exists: async () => ({ _id: ORGANIZATION_ID }),
  },
  UserModel: {
    findById: () => ({
      select: async () => user,
    }),
  },
  MembershipModel: {
    findOne: () => ({
      select: async () => replacementOwner,
    }),
  },
});

test("query-based role mutation validates platform conflict", async () => {
  await assert.rejects(
    validateOrganizationMembershipQueryMutation({
      current: currentMembership(),
      normalizedUpdate: { $set: { role: "manager" } },
      ...dependencies({
        user: { _id: USER_ID, platformRole: "platform-admin" },
      }),
    }),
    (error) => error.code === "PLATFORM_ORGANIZATION_ROLE_CONFLICT"
  );
});

test("query-based status mutation preserves the canonical invariant", () => {
  assert.deepEqual(
    normalizeOrganizationMembershipUpdate({
      $set: { status: "inactive", isActive: true },
    }),
    {
      $set: { status: "inactive", isActive: false },
    }
  );
  assert.deepEqual(
    normalizeOrganizationMembershipUpdate({
      $set: { status: "active", isActive: false },
    }),
    {
      $set: { status: "inactive", isActive: false },
    }
  );
});

test("alternate update cannot remove the final active owner", async () => {
  await assert.rejects(
    validateOrganizationMembershipQueryMutation({
      current: currentMembership({ role: "owner" }),
      normalizedUpdate: { $set: { status: "inactive", isActive: false } },
      ...dependencies({ replacementOwner: null }),
    }),
    (error) => error.code === "ORGANIZATION_FINAL_OWNER_REQUIRED"
  );
});

for (const [field, value, code] of [
  ["role", "platform-admin", "INVALID_ORGANIZATION_ROLE"],
  ["status", "paused", "INVALID_ORGANIZATION_MEMBERSHIP_STATUS"],
]) {
  test(`malformed membership ${field} fails safely`, async () => {
    await assert.rejects(
      validateOrganizationMembershipQueryMutation({
        current: currentMembership(),
        normalizedUpdate: { $set: { [field]: value } },
        ...dependencies(),
      }),
      (error) => error.code === code
    );
  });
}

test("validated query mutation accepts a safe service-equivalent change", async () => {
  await validateOrganizationMembershipQueryMutation({
    current: currentMembership(),
    normalizedUpdate: { $set: { role: "viewer" } },
    ...dependencies(),
  });
});
