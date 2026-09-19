import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import OrganizationOwnerAudit from "../models/organizationOwnerAudit.js";
import User from "../models/user.js";
import {
  listEligibleOrganizationOwnerCandidates,
  transferOrganizationOwner,
} from "../services/organizationOwnerTransferService.js";

let replicaSet;
let sequence = 0;

const next = (prefix) => `${prefix}-${++sequence}`;

const createUser = (overrides = {}) =>
  User.create({
    name: "Test User",
    email: `${next("user")}@example.com`,
    phone: next("+1555"),
    password: "integration-password",
    platformRole: "none",
    isApproved: true,
    accountStatus: "active",
    ...overrides,
  });

const createOrganization = (ownerId) =>
  Organization.create({
    name: next("Organization"),
    slug: next("organization"),
    createdByUserId: ownerId,
  });

const createMembership = ({ organizationId, userId, role = "member", status = "active" }) =>
  OrganizationMembership.create({ organizationId, userId, role, status });

const actor = () => ({
  _id: new mongoose.Types.ObjectId(),
  platformRole: "platform-admin",
});

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replicaSet.getUri(), { dbName: "owner-transfer" });
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await Promise.all([
    Organization.syncIndexes(),
    OrganizationMembership.syncIndexes(),
    OrganizationOwnerAudit.syncIndexes(),
    User.syncIndexes(),
  ]);
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet?.stop();
});

test("transfers ownership to an existing member and preserves the other memberships", async () => {
  const currentOwner = await createUser({ name: "Current Owner" });
  const replacement = await createUser({ name: "Replacement" });
  const otherOrganization = await createOrganization(replacement._id);
  const organization = await createOrganization(currentOwner._id);
  const currentMembership = await createMembership({ organizationId: organization._id, userId: currentOwner._id, role: "owner" });
  const replacementMembership = await createMembership({ organizationId: organization._id, userId: replacement._id, role: "member" });
  const otherMembership = await createMembership({ organizationId: otherOrganization._id, userId: replacement._id, role: "admin" });

  const result = await transferOrganizationOwner({
    actor: actor(),
    organizationId: organization._id,
    newOwner: { mode: "existing_member", userId: replacement._id },
    formerOwnerAction: "member",
    transactionSupported: true,
  });

  assert.equal(String(result.ownerUser._id), String(replacement._id));
  assert.equal((await OrganizationMembership.find({ organizationId: organization._id, role: "owner", status: "active" })).length, 1);
  assert.equal((await OrganizationMembership.findById(currentMembership._id)).role, "member");
  assert.equal((await OrganizationMembership.findById(replacementMembership._id)).role, "owner");
  assert.equal((await OrganizationMembership.findById(otherMembership._id)).role, "admin");
  assert.equal(await OrganizationOwnerAudit.countDocuments({ eventType: "organization_owner_transferred" }), 1);
});

test("creates a new owner User and reports post-commit notification failure safely", async () => {
  const currentOwner = await createUser();
  const organization = await createOrganization(currentOwner._id);
  await createMembership({ organizationId: organization._id, userId: currentOwner._id, role: "owner" });
  const issueReset = async ({ user }) => {
    await user.save();
    throw new Error("mail unavailable");
  };

  const result = await transferOrganizationOwner({
    actor: actor(),
    organizationId: organization._id,
    newOwner: { mode: "new_user", name: "New Owner", email: "new-owner@example.com", phone: "+15550101" },
    formerOwnerAction: "remove",
    transactionSupported: true,
    issueReset,
  });

  assert.equal(result.newUserCreated, true);
  assert.equal(result.notificationSent, false);
  assert.equal(result.notificationPending, true);
  const newUser = await User.findOne({ email: "new-owner@example.com" });
  assert.ok(newUser);
  assert.equal((await OrganizationMembership.findOne({ organizationId: organization._id, userId: newUser._id })).role, "owner");
  assert.equal((await OrganizationMembership.findOne({ organizationId: organization._id, userId: currentOwner._id })).status, "removed");
});

test("applies every explicit former-owner action", async () => {
  for (const formerOwnerAction of ["admin", "member", "remove"]) {
    const currentOwner = await createUser();
    const replacement = await createUser();
    const organization = await createOrganization(currentOwner._id);
    await createMembership({ organizationId: organization._id, userId: currentOwner._id, role: "owner" });
    await createMembership({ organizationId: organization._id, userId: replacement._id, role: "member" });

    await transferOrganizationOwner({
      actor: actor(),
      organizationId: organization._id,
      newOwner: { mode: "existing_member", userId: replacement._id },
      formerOwnerAction,
      transactionSupported: true,
    });

    const formerOwnerMembership = await OrganizationMembership.findOne({
      organizationId: organization._id,
      userId: currentOwner._id,
    });
    assert.equal(formerOwnerMembership.role, formerOwnerAction === "remove" ? "member" : formerOwnerAction);
    assert.equal(formerOwnerMembership.status, formerOwnerAction === "remove" ? "removed" : "active");
  }
});

test("rejects ownerless and multiple-owner Organizations", async () => {
  const first = await createUser();
  const second = await createUser();
  const ownerless = await createOrganization(first._id);
  await createMembership({ organizationId: ownerless._id, userId: first._id, role: "member" });
  await assert.rejects(
    transferOrganizationOwner({ actor: actor(), organizationId: ownerless._id, newOwner: { mode: "existing_member", userId: first._id }, formerOwnerAction: "member", transactionSupported: true }),
    (error) => error.code === "ORGANIZATION_OWNER_REQUIRED",
  );

  const multiple = await createOrganization(first._id);
  await createMembership({ organizationId: multiple._id, userId: first._id, role: "owner" });
  await createMembership({ organizationId: multiple._id, userId: second._id, role: "owner" });
  await assert.rejects(
    transferOrganizationOwner({ actor: actor(), organizationId: multiple._id, newOwner: { mode: "existing_member", userId: first._id }, formerOwnerAction: "member", transactionSupported: true }),
    (error) => error.code === "ORGANIZATION_OWNER_INTEGRITY_ERROR",
  );
});

test("does not leave membership changes when audit persistence fails", async (t) => {
  const currentOwner = await createUser();
  const replacement = await createUser();
  const organization = await createOrganization(currentOwner._id);
  await createMembership({ organizationId: organization._id, userId: currentOwner._id, role: "owner" });
  await createMembership({ organizationId: organization._id, userId: replacement._id, role: "member" });
  t.mock.method(OrganizationOwnerAudit, "create", async () => {
    throw new Error("audit unavailable");
  });

  await assert.rejects(
    transferOrganizationOwner({ actor: actor(), organizationId: organization._id, newOwner: { mode: "existing_member", userId: replacement._id }, formerOwnerAction: "admin", transactionSupported: true }),
    /audit unavailable/,
  );
  assert.equal((await OrganizationMembership.findOne({ organizationId: organization._id, userId: currentOwner._id })).role, "owner");
  assert.equal((await OrganizationMembership.findOne({ organizationId: organization._id, userId: replacement._id })).role, "member");
});

test("concurrent transfers allow only one transaction to advance the Organization version", async () => {
  const currentOwner = await createUser();
  const firstReplacement = await createUser();
  const secondReplacement = await createUser();
  const organization = await createOrganization(currentOwner._id);
  await createMembership({ organizationId: organization._id, userId: currentOwner._id, role: "owner" });
  await createMembership({ organizationId: organization._id, userId: firstReplacement._id, role: "member" });
  await createMembership({ organizationId: organization._id, userId: secondReplacement._id, role: "member" });

  const results = await Promise.allSettled([
    transferOrganizationOwner({
      actor: actor(),
      organizationId: organization._id,
      newOwner: { mode: "existing_member", userId: firstReplacement._id },
      formerOwnerAction: "member",
      transactionSupported: true,
    }),
    transferOrganizationOwner({
      actor: actor(),
      organizationId: organization._id,
      newOwner: { mode: "existing_member", userId: secondReplacement._id },
      formerOwnerAction: "member",
      transactionSupported: true,
    }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(
    await OrganizationMembership.countDocuments({
      organizationId: organization._id,
      role: "owner",
      status: "active",
    }),
    1,
  );
});

test("lists only eligible non-owner members", async () => {
  const currentOwner = await createUser();
  const eligible = await createUser();
  const suspended = await createUser({ accountStatus: "suspended" });
  const organization = await createOrganization(currentOwner._id);
  await createMembership({ organizationId: organization._id, userId: currentOwner._id, role: "owner" });
  await createMembership({ organizationId: organization._id, userId: eligible._id, role: "manager" });
  await createMembership({ organizationId: organization._id, userId: suspended._id, role: "member" });

  const candidates = await listEligibleOrganizationOwnerCandidates({ actor: actor(), organizationId: organization._id });
  assert.deepEqual(candidates.map((candidate) => String(candidate.userId)), [String(eligible._id)]);
});

test("rejects non-platform actors and invalid former-owner actions", async () => {
  const owner = await createUser();
  const replacement = await createUser();
  const organization = await createOrganization(owner._id);
  await createMembership({ organizationId: organization._id, userId: owner._id, role: "owner" });
  await createMembership({ organizationId: organization._id, userId: replacement._id });
  await assert.rejects(
    transferOrganizationOwner({ actor: { platformRole: "none" }, organizationId: organization._id, newOwner: { mode: "existing_member", userId: replacement._id }, formerOwnerAction: "member", transactionSupported: true }),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    transferOrganizationOwner({ actor: actor(), organizationId: organization._id, newOwner: { mode: "existing_member", userId: replacement._id }, formerOwnerAction: "invalid", transactionSupported: true }),
    (error) => error.code === "FORMER_OWNER_ACTION_REQUIRED",
  );
});
