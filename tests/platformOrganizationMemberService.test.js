import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import OrganizationMembershipAudit from "../models/organizationMembershipAudit.js";
import User from "../models/user.js";
import {
  platformMemberMutationResponse,
  platformMembershipResponse,
} from "../controllers/organizationController.js";
import { resolveCompanyAccess } from "../services/companyAccessService.js";
import {
  addPlatformOrganizationMember,
  removePlatformOrganizationMember,
  updatePlatformOrganizationMember,
} from "../services/platformOrganizationMemberService.js";

let replicaSet;
let sequence = 0;

const next = (prefix) => `${prefix}-${++sequence}`;
const actor = (platformRole = "platform-admin") => ({
  _id: new mongoose.Types.ObjectId(),
  platformRole,
});
const createUser = (overrides = {}) =>
  User.create({
    name: "Organization User",
    email: `${next("user")}@example.com`,
    phone: `+1555${String(++sequence).padStart(7, "0")}`,
    password: "integration-password",
    platformRole: "none",
    isApproved: true,
    accountStatus: "active",
    invitationStatus: "accepted",
    ...overrides,
  });
const createOrganization = (ownerId) =>
  Organization.create({
    name: next("Organization"),
    slug: next("organization"),
    createdByUserId: ownerId,
  });
const createMembership = ({ organizationId, userId, role = "owner", status = "active" }) =>
  OrganizationMembership.create({ organizationId, userId, role, status });
const responseFor = (result) => platformMemberMutationResponse(result);
const assertResponse = (response, expected) => {
  assert.deepEqual(response, {
    membershipId: expected.membershipId,
    userId: expected.userId,
    name: expected.name,
    email: expected.email,
    role: expected.role,
    status: expected.status,
    isActive: expected.isActive,
  });
};
const assertAuditRecord = (audit, { organizationId, membershipId, affectedUserId, actorUserId, eventType, beforeRole, afterRole, beforeStatus, afterStatus }) => {
  assert.equal(audit.eventType, eventType);
  assert.equal(audit.action, eventType.replace("organization_member_", ""));
  assert.equal(String(audit.organizationId), String(organizationId));
  assert.equal(String(audit.membershipId), String(membershipId));
  assert.equal(String(audit.affectedUserId), String(affectedUserId));
  assert.equal(String(audit.actorUserId), String(actorUserId));
  assert.equal(audit.actorPlatformRole, "platform-admin");
  assert.equal(audit.beforeRole, beforeRole);
  assert.equal(audit.afterRole, afterRole);
  assert.equal(audit.beforeStatus, beforeStatus);
  assert.equal(audit.afterStatus, afterStatus);
  assert.equal("password" in audit, false);
  assert.equal("token" in audit, false);
  assert.equal("oauth" in audit, false);
};
const assertAudit = async (expected) => {
  const audits = await OrganizationMembershipAudit.find({ organizationId: expected.organizationId }).lean();
  assert.equal(audits.length, 1);
  assertAuditRecord(audits[0], expected);
};

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replicaSet.getUri(), { dbName: "platform-member-management" });
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await Promise.all([
    Organization.syncIndexes(),
    OrganizationMembership.syncIndexes(),
    OrganizationMembershipAudit.syncIndexes(),
    User.syncIndexes(),
  ]);
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet?.stop();
});

test("adds an eligible existing User with a normalized email and safe audit", async () => {
  const owner = await createUser({ name: "Owner" });
  const member = await createUser({ name: "Member", email: "member@example.com" });
  const organization = await createOrganization(owner._id);
  await createMembership({ organizationId: organization._id, userId: owner._id });
  const platformActor = actor();

  const result = await addPlatformOrganizationMember({
    actor: platformActor,
    organizationId: organization._id,
    email: " MEMBER@EXAMPLE.COM ",
    role: "manager",
    transactionSupported: true,
  });

  assert.equal(String(result.user._id), String(member._id));
  assert.equal(result.membership.role, "manager");
  const mutationResponse = responseFor(result);
  assert.equal(mutationResponse.success, true);
  assertResponse(mutationResponse.membership, {
    membershipId: result.membership._id,
    userId: member._id,
    name: member.name,
    email: member.email,
    role: "manager",
    status: "active",
    isActive: true,
  });
  assertResponse(platformMembershipResponse({ ...result.membership.toObject(), userId: member._id }, member), {
    membershipId: result.membership._id,
    userId: member._id,
    name: member.name,
    email: member.email,
    role: "manager",
    status: "active",
    isActive: true,
  });
  assert.equal(await OrganizationMembership.countDocuments({ organizationId: organization._id }), 2);
  await assertAudit({
    organizationId: organization._id,
    membershipId: result.membership._id,
    affectedUserId: member._id,
    actorUserId: platformActor._id,
    eventType: "organization_member_added",
    beforeRole: null,
    afterRole: "manager",
    beforeStatus: null,
    afterStatus: "active",
  });
});

test("allows Platform owner and rejects non-platform actors", async () => {
  const owner = await createUser();
  const member = await createUser({ email: "member@example.com" });
  const organization = await createOrganization(owner._id);
  await createMembership({ organizationId: organization._id, userId: owner._id });

  await assert.rejects(
    () => addPlatformOrganizationMember({ actor: actor("none"), organizationId: organization._id, email: member.email, role: "member", transactionSupported: true }),
    (error) => error.code === "PLATFORM_ROLE_REQUIRED",
  );
  await addPlatformOrganizationMember({ actor: actor("platform-owner"), organizationId: organization._id, email: member.email, role: "member", transactionSupported: true });
});

test("rejects owner role, duplicate membership, platform, suspended, removed, and unapproved Users", async () => {
  const owner = await createUser();
  const member = await createUser({ email: "member@example.com" });
  const organization = await createOrganization(owner._id);
  await createMembership({ organizationId: organization._id, userId: owner._id });
  const options = { actor: actor(), organizationId: organization._id, transactionSupported: true };

  await assert.rejects(() => addPlatformOrganizationMember({ ...options, email: member.email, role: "owner" }), (error) => error.code === "ORGANIZATION_MEMBER_ROLE_INVALID");
  await addPlatformOrganizationMember({ ...options, email: member.email, role: "member" });
  await assert.rejects(() => addPlatformOrganizationMember({ ...options, email: member.email, role: "viewer" }), (error) => error.code === "ORGANIZATION_MEMBERSHIP_EXISTS");
  for (const overrides of [
    { email: "platform@example.com", platformRole: "platform-admin" },
    { email: "suspended@example.com", accountStatus: "suspended" },
    { email: "removed@example.com", accountStatus: "removed" },
    { email: "unapproved@example.com", isApproved: false },
  ]) {
    const user = await createUser(overrides);
    await assert.rejects(() => addPlatformOrganizationMember({ ...options, email: user.email, role: "member" }), (error) => ["PLATFORM_ORGANIZATION_ROLE_CONFLICT", "ORGANIZATION_USER_INELIGIBLE"].includes(error.code));
  }
});

test("changes ordinary roles and deactivates/reactivates with synchronized status", async () => {
  const owner = await createUser();
  const member = await createUser({ email: "member@example.com" });
  const organization = await createOrganization(owner._id);
  await createMembership({ organizationId: organization._id, userId: owner._id });
  const membership = await createMembership({ organizationId: organization._id, userId: member._id, role: "member" });
  const options = { actor: actor(), organizationId: organization._id, membershipId: membership._id, transactionSupported: true };

  const roleResult = await updatePlatformOrganizationMember({ ...options, role: "admin" });
  assert.equal(roleResult.membership.role, "admin");
  assertResponse(responseFor(roleResult).membership, {
    membershipId: membership._id,
    userId: member._id,
    name: member.name,
    email: member.email,
    role: "admin",
    status: "active",
    isActive: true,
  });
  const roleAudit = await OrganizationMembershipAudit.findOne({ organizationId: organization._id, eventType: "organization_member_role_changed" }).lean();
  assertAuditRecord(roleAudit, {
    organizationId: organization._id,
    membershipId: membership._id,
    affectedUserId: member._id,
    actorUserId: options.actor._id,
    eventType: "organization_member_role_changed",
    beforeRole: "member",
    afterRole: "admin",
    beforeStatus: "active",
    afterStatus: "active",
  });
  const inactive = await updatePlatformOrganizationMember({ ...options, status: "inactive" });
  assert.equal(inactive.membership.status, "inactive");
  assert.equal(inactive.membership.isActive, false);
  assertResponse(responseFor(inactive).membership, {
    membershipId: membership._id,
    userId: member._id,
    name: member.name,
    email: member.email,
    role: "admin",
    status: "inactive",
    isActive: false,
  });
  await assert.rejects(() => updatePlatformOrganizationMember({ ...options, role: "viewer" }), (error) => error.code === "ORGANIZATION_MEMBER_REACTIVATE_FIRST");
  const active = await updatePlatformOrganizationMember({ ...options, status: "active" });
  assert.equal(active.membership.status, "active");
  assert.equal(active.membership.isActive, true);
  assertResponse(responseFor(active).membership, {
    membershipId: membership._id,
    userId: member._id,
    name: member.name,
    email: member.email,
    role: "admin",
    status: "active",
    isActive: true,
  });
  const lifecycleAudits = await OrganizationMembershipAudit.find({ organizationId: organization._id }).sort({ createdAt: 1 }).lean();
  assert.equal(lifecycleAudits.length, 3);
  assert.deepEqual(lifecycleAudits.map((audit) => audit.eventType), [
    "organization_member_role_changed",
    "organization_member_deactivated",
    "organization_member_reactivated",
  ]);
  assertAuditRecord(lifecycleAudits[1], {
    organizationId: organization._id,
    membershipId: membership._id,
    affectedUserId: member._id,
    actorUserId: options.actor._id,
    eventType: "organization_member_deactivated",
    beforeRole: "admin",
    afterRole: "admin",
    beforeStatus: "active",
    afterStatus: "inactive",
  });
  assertAuditRecord(lifecycleAudits[2], {
    organizationId: organization._id,
    membershipId: membership._id,
    affectedUserId: member._id,
    actorUserId: options.actor._id,
    eventType: "organization_member_reactivated",
    beforeRole: "admin",
    afterRole: "admin",
    beforeStatus: "inactive",
    afterStatus: "active",
  });
});

test("removes a non-owner softly and preserves the User and other Organization membership", async () => {
  const owner = await createUser();
  const member = await createUser({ email: "member@example.com" });
  const first = await createOrganization(owner._id);
  const second = await createOrganization(owner._id);
  await createMembership({ organizationId: first._id, userId: owner._id });
  const target = await createMembership({ organizationId: first._id, userId: member._id, role: "member" });
  const other = await createMembership({ organizationId: second._id, userId: member._id, role: "admin" });
  const platformActor = actor();

  const result = await removePlatformOrganizationMember({ actor: platformActor, organizationId: first._id, membershipId: target._id, transactionSupported: true });
  assert.equal(result.membership.status, "removed");
  assert.equal(result.membership.isActive, false);
  assertResponse(responseFor(result).membership, {
    membershipId: target._id,
    userId: member._id,
    name: member.name,
    email: member.email,
    role: "member",
    status: "removed",
    isActive: false,
  });
  assert.equal(await User.countDocuments({ _id: member._id }), 1);
  assert.equal((await OrganizationMembership.findById(other._id)).status, "active");
  await assertAudit({
    organizationId: first._id,
    membershipId: target._id,
    affectedUserId: member._id,
    actorUserId: platformActor._id,
    eventType: "organization_member_removed",
    beforeRole: "member",
    afterRole: "member",
    beforeStatus: "active",
    afterStatus: "removed",
  });
});

test("audit failure rolls back the membership mutation", async (t) => {
  const owner = await createUser();
  const member = await createUser({ email: "member@example.com" });
  const organization = await createOrganization(owner._id);
  await createMembership({ organizationId: organization._id, userId: owner._id });
  const membership = await createMembership({ organizationId: organization._id, userId: member._id, role: "member" });
  t.mock.method(OrganizationMembershipAudit, "create", async () => {
    throw new Error("audit unavailable");
  });

  await assert.rejects(
    () => updatePlatformOrganizationMember({ actor: actor(), organizationId: organization._id, membershipId: membership._id, role: "manager", transactionSupported: true }),
    /audit unavailable/,
  );
  const persisted = await OrganizationMembership.findById(membership._id);
  assert.equal(persisted.role, "member");
  assert.equal(await OrganizationMembershipAudit.countDocuments({ organizationId: organization._id }), 0);
});

test("concurrent Platform membership mutations allow only one version to advance", async () => {
  const owner = await createUser();
  const member = await createUser({ email: "member@example.com" });
  const organization = await createOrganization(owner._id);
  await createMembership({ organizationId: organization._id, userId: owner._id });
  const membership = await createMembership({ organizationId: organization._id, userId: member._id, role: "member" });
  const input = { actor: actor(), organizationId: organization._id, membershipId: membership._id, transactionSupported: true };
  const outcomes = await Promise.allSettled([
    updatePlatformOrganizationMember({ ...input, role: "admin" }),
    updatePlatformOrganizationMember({ ...input, role: "viewer" }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected" && outcome.reason.code === "ORGANIZATION_MEMBER_CONFLICT").length, 1);
  assert.equal((await OrganizationMembership.findById(membership._id)).memberManagementVersion, 1);
});

test("locks owners, scopes membership IDs, and fails closed on multiple owners", async () => {
  const owner = await createUser();
  const secondOwner = await createUser({ email: "second@example.com" });
  const otherOrg = await createOrganization(owner._id);
  const organization = await createOrganization(owner._id);
  const ownerMembership = await createMembership({ organizationId: organization._id, userId: owner._id });
  const otherMembership = await createMembership({ organizationId: otherOrg._id, userId: secondOwner._id, role: "member" });
  const options = { actor: actor(), organizationId: organization._id, membershipId: ownerMembership._id, transactionSupported: true };
  await assert.rejects(() => updatePlatformOrganizationMember({ ...options, role: "admin" }), (error) => error.code === "ORGANIZATION_OWNER_MANAGED_SEPARATELY");
  await assert.rejects(() => removePlatformOrganizationMember({ actor: actor(), organizationId: organization._id, membershipId: otherMembership._id, transactionSupported: true }), (error) => error.code === "ORGANIZATION_MEMBERSHIP_NOT_FOUND");
  await createMembership({ organizationId: organization._id, userId: secondOwner._id, role: "owner" });
  const regular = await createUser({ email: "regular@example.com" });
  await assert.rejects(() => addPlatformOrganizationMember({ actor: actor(), organizationId: organization._id, email: regular.email, role: "member", transactionSupported: true }), (error) => error.code === "ORGANIZATION_OWNER_INTEGRITY_ERROR");
});

test("Distributor delegated access follows Organization membership without changing Company data", async () => {
  const owner = await createUser();
  const distributorAdmin = await createUser({ email: "admin@example.com" });
  const organization = await Organization.create({ name: next("Distributor"), slug: next("distributor"), organizationType: "distributor", createdByUserId: owner._id });
  await createMembership({ organizationId: organization._id, userId: owner._id });
  const membership = await createMembership({ organizationId: organization._id, userId: distributorAdmin._id, role: "admin" });
  const company = await Company.create({ name: next("Company"), slug: next("company"), organizationId: organization._id, ownerUserId: owner._id });
  const ownerBefore = String(company.ownerUserId);
  const before = await resolveCompanyAccess({ userId: distributorAdmin._id, companyId: company._id, user: distributorAdmin });
  assert.equal(before.allowed, true);
  await updatePlatformOrganizationMember({ actor: actor(), organizationId: organization._id, membershipId: membership._id, role: "member", transactionSupported: true });
  const after = await resolveCompanyAccess({ userId: distributorAdmin._id, companyId: company._id, user: distributorAdmin });
  assert.equal(after, null);
  assert.equal(String((await Company.findById(company._id)).ownerUserId), ownerBefore);
  assert.equal((await OrganizationMembership.findById(membership._id)).role, "member");
  assert.equal(await CompanyMembership.countDocuments({ companyId: company._id, userId: distributorAdmin._id }), 0);
});
