import assert from "node:assert/strict";
import test from "node:test";

import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import User from "../models/user.js";
import {
  addOrganizationMember,
  assignInitialOrganizationOwner,
  updateOrganizationMember,
} from "../services/organizationService.js";
import {
  ORGANIZATION_OWNER_INTEGRITY,
  resolveOrganizationOwnerIntegrity,
} from "../services/organizationOwnerIntegrityService.js";

const ORGANIZATION_ID = "64b000000000000000000001";
const OWNER_ID = "64b000000000000000000002";
const MEMBER_ID = "64b000000000000000000003";
const ACTOR_ID = "64b000000000000000000004";

const organization = { _id: ORGANIZATION_ID, organizationType: "distributor" };
const ownerMembership = () => ({
  _id: "64b000000000000000000005",
  organizationId: ORGANIZATION_ID,
  userId: OWNER_ID,
  role: "owner",
  status: "active",
});

const eligibleUser = {
  _id: MEMBER_ID,
  platformRole: "none",
  isApproved: true,
  accountStatus: "active",
  invitationStatus: "accepted",
};

const installOwnerMocks = (t, owners = []) => {
  t.mock.method(Organization, "findById", async () => organization);
  t.mock.method(OrganizationMembership, "find", async () => owners);
  t.mock.method(OrganizationMembership, "findOne", async () => null);
  t.mock.method(User, "findById", () => ({
    select: async () => eligibleUser,
  }));
};

test("owner-integrity resolver distinguishes ownerless, valid, and multiple states", async (t) => {
  const states = [
    [[], ORGANIZATION_OWNER_INTEGRITY.OWNERLESS, false],
    [[ownerMembership()], ORGANIZATION_OWNER_INTEGRITY.VALID, true],
    [
      [ownerMembership(), { ...ownerMembership(), _id: "64b000000000000000000006" }],
      ORGANIZATION_OWNER_INTEGRITY.MULTIPLE_OWNERS,
      false,
    ],
  ];

  for (const [owners, expectedStatus, hasOwner] of states) {
    const result = await resolveOrganizationOwnerIntegrity({
      organizationId: ORGANIZATION_ID,
      MembershipModel: { find: async () => owners },
    });
    assert.equal(result.status, expectedStatus);
    assert.equal(result.ownerCount, owners.length);
    assert.equal(Boolean(result.ownerMembership), hasOwner);
  }
});

test("ownerless Organization permits initial owner assignment", async (t) => {
  const owners = [];
  installOwnerMocks(t, owners);
  const created = [];
  t.mock.method(OrganizationMembership, "create", async (input) => {
    created.push(input);
    owners.push(input);
    return input;
  });

  const result = await assignInitialOrganizationOwner({
    actor: { _id: ACTOR_ID, platformRole: "platform-admin" },
    organizationId: ORGANIZATION_ID,
    userId: MEMBER_ID,
  });

  assert.equal(result.role, "owner");
  assert.equal(result.status, "active");
  assert.equal(created.length, 1);

  await assert.rejects(
    assignInitialOrganizationOwner({
      actor: { _id: ACTOR_ID, platformRole: "platform-admin" },
      organizationId: ORGANIZATION_ID,
      userId: MEMBER_ID,
    }),
    (error) => error.code === "ORGANIZATION_OWNER_EXISTS" && error.statusCode === 409,
  );
});

test("adding a second owner is rejected", async (t) => {
  installOwnerMocks(t, [ownerMembership()]);

  await assert.rejects(
    addOrganizationMember({
      organization,
      actorMembership: { userId: ACTOR_ID, role: "owner", status: "active" },
      input: { userId: MEMBER_ID, role: "owner" },
    }),
    (error) =>
      error.code === "ORGANIZATION_ALREADY_HAS_OWNER" && error.statusCode === 409,
  );
});

test("promoting a member to owner is rejected when an owner exists", async (t) => {
  installOwnerMocks(t, [ownerMembership()]);
  const target = {
    _id: "64b000000000000000000007",
    organizationId: ORGANIZATION_ID,
    userId: MEMBER_ID,
    role: "member",
    status: "active",
    save: async () => assert.fail("membership should not be saved"),
  };
  t.mock.method(OrganizationMembership, "findOne", async () => target);

  await assert.rejects(
    updateOrganizationMember({
      organization,
      actorMembership: { userId: ACTOR_ID, role: "owner", status: "active" },
      membershipId: target._id,
      updates: { role: "owner" },
    }),
    (error) =>
      error.code === "ORGANIZATION_ALREADY_HAS_OWNER" && error.statusCode === 409,
  );
});

test("multiple active owners fail closed without selecting a canonical owner", async () => {
  const first = ownerMembership();
  const second = { ...ownerMembership(), _id: "64b000000000000000000006" };
  const result = await resolveOrganizationOwnerIntegrity({
    organizationId: ORGANIZATION_ID,
    MembershipModel: { find: async () => [first, second] },
  });

  assert.equal(result.status, ORGANIZATION_OWNER_INTEGRITY.MULTIPLE_OWNERS);
  assert.equal(result.ownerMembership, null);
});
