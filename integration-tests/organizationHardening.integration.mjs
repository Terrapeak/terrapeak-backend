import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { after, before, beforeEach, test } from "node:test";
import { promisify } from "node:util";

import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import Company from "../models/company.js";
import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import User from "../models/user.js";
import {
  auditOrganizationIndexes,
} from "../scripts/auditOrganizationIndexes.js";
import {
  auditOrganizationHardening,
} from "../scripts/auditOrganizationHardening.js";
import { createOrganization } from "../services/organizationService.js";

let replicaSet;
let sequence = 0;
const execFileAsync = promisify(execFile);

const nextValue = (prefix) => `${prefix}-${++sequence}`;

const createUser = async (overrides = {}) =>
  User.create({
    name: "Integration User",
    email: `${nextValue("user")}@example.com`,
    phone: nextValue("+1555"),
    password: "integration-password",
    platformRole: "none",
    isAdmin: false,
    isApproved: true,
    ...overrides,
  });

const createOrganizationDocument = async (createdByUserId, overrides = {}) =>
  Organization.create({
    name: nextValue("Organization"),
    slug: nextValue("organization"),
    createdByUserId,
    ...overrides,
  });

const createMembership = async ({
  organization,
  user,
  role = "member",
  status = "active",
}) =>
  OrganizationMembership.create({
    organizationId: organization._id,
    userId: user._id,
    role,
    status,
  });

const syncCriticalIndexes = async () => {
  await Organization.syncIndexes();
  await OrganizationMembership.syncIndexes();
  await Company.syncIndexes();
  await User.syncIndexes();
};

const runAuditCommand = (script) =>
  execFileAsync(process.execPath, [script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DOTENV_CONFIG_QUIET: "true",
      MONGO_URI: replicaSet.getUri(
        "organization-hardening-integration"
      ),
    },
  });

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replicaSet.getUri(), {
    dbName: "organization-hardening-integration",
  });
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await syncCriticalIndexes();
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet?.stop();
});

test("declared indexes build and unique indexes reject duplicates", async () => {
  const actor = await createUser();
  const organization = await createOrganizationDocument(actor._id, {
    slug: "unique-organization",
  });

  await assert.rejects(
    createOrganizationDocument(actor._id, {
      slug: "unique-organization",
    }),
    (error) => error.code === 11000
  );

  const member = await createUser();
  await createMembership({ organization, user: member });
  await assert.rejects(
    createMembership({ organization, user: member, role: "viewer" }),
    (error) => error.code === 11000
  );

  const report = await auditOrganizationIndexes();
  assert.equal(report.ok, true);
  const command = await runAuditCommand(
    "scripts/auditOrganizationIndexes.js"
  );
  assert.equal(JSON.parse(command.stdout).ok, true);
});

test("index audit fails when a required index is missing", async () => {
  await Organization.collection.dropIndex("status_1");
  const report = await auditOrganizationIndexes();
  assert.equal(report.ok, false);
  const organizationReport = report.models.find(
    (result) => result.model === "Organization"
  );
  assert.deepEqual(organizationReport.missing, [
    { key: { status: 1 }, unique: false },
  ]);
  await assert.rejects(
    runAuditCommand("scripts/auditOrganizationIndexes.js"),
    (error) => error.code === 1
  );
});

test("document, query, and legacy admin promotion paths enforce the reverse guard", async () => {
  const actor = await createUser();
  const organization = await createOrganizationDocument(actor._id);
  const member = await createUser();
  await createMembership({ organization, user: member, role: "manager" });

  member.platformRole = "platform-admin";
  await assert.rejects(member.save(), {
    code: "ACTIVE_ORGANIZATION_MEMBERSHIP_CONFLICT",
  });
  assert.equal(
    (await User.findById(member._id).lean()).platformRole,
    "none"
  );

  await assert.rejects(
    User.findByIdAndUpdate(member._id, {
      $set: { isAdmin: true },
    }),
    { code: "ACTIVE_ORGANIZATION_MEMBERSHIP_CONFLICT" }
  );
  assert.equal((await User.findById(member._id).lean()).isAdmin, false);

  await assert.rejects(
    User.bulkWrite([
      {
        updateOne: {
          filter: { _id: member._id },
          update: { $set: { platformRole: "platform-owner" } },
        },
      },
    ]),
    { code: "ACTIVE_ORGANIZATION_MEMBERSHIP_CONFLICT" }
  );
  assert.equal(
    (await User.findById(member._id).lean()).platformRole,
    "none"
  );
});

test("inactive and removed memberships do not block promotion", async () => {
  for (const status of ["inactive", "removed"]) {
    const actor = await createUser();
    const organization = await createOrganizationDocument(actor._id);
    const user = await createUser();
    await createMembership({ organization, user, status });

    await User.findByIdAndUpdate(user._id, {
      $set: { platformRole: "support-admin" },
    });
    assert.equal(
      (await User.findById(user._id).lean()).platformRole,
      "support-admin"
    );
  }
});

test("query membership writes enforce role separation and canonical status", async () => {
  const actor = await createUser();
  const organization = await createOrganizationDocument(actor._id);
  const platformUser = await createUser({
    platformRole: "platform-admin",
  });
  const rawMembershipId = new mongoose.Types.ObjectId();
  await OrganizationMembership.collection.insertOne({
    _id: rawMembershipId,
    organizationId: organization._id,
    userId: platformUser._id,
    role: "member",
    status: "active",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await assert.rejects(
    OrganizationMembership.findByIdAndUpdate(rawMembershipId, {
      $set: { role: "viewer" },
    }),
    (error) => error.code === "PLATFORM_ORGANIZATION_ROLE_CONFLICT"
  );

  await OrganizationMembership.collection.deleteOne({
    _id: rawMembershipId,
  });
  const customer = await createUser();
  const membership = await createMembership({
    organization,
    user: customer,
  });
  await OrganizationMembership.findByIdAndUpdate(membership._id, {
    $set: { status: "inactive", isActive: true },
  });
  const updated = await OrganizationMembership.findById(
    membership._id
  ).lean();
  assert.equal(updated.status, "inactive");
  assert.equal(updated.isActive, false);
});

test("alternate membership paths reject final-owner removal and malformed values", async () => {
  const actor = await createUser();
  const organization = await createOrganizationDocument(actor._id);
  const owner = await createUser();
  const membership = await createMembership({
    organization,
    user: owner,
    role: "owner",
  });

  await assert.rejects(
    OrganizationMembership.findByIdAndUpdate(membership._id, {
      $set: { status: "inactive" },
    }),
    { code: "ORGANIZATION_FINAL_OWNER_REQUIRED" }
  );
  await assert.rejects(
    OrganizationMembership.findByIdAndUpdate(membership._id, {
      $set: { role: "platform-admin" },
    }),
    { code: "INVALID_ORGANIZATION_ROLE" }
  );
  await assert.rejects(
    OrganizationMembership.findByIdAndUpdate(membership._id, {
      $set: { status: "paused" },
    }),
    { code: "INVALID_ORGANIZATION_MEMBERSHIP_STATUS" }
  );
  await assert.rejects(
    OrganizationMembership.updateMany(
      { organizationId: organization._id },
      { $set: { status: "inactive" } }
    ),
    { code: "ORGANIZATION_MEMBERSHIP_SERVICE_REQUIRED" }
  );
  await assert.rejects(
    OrganizationMembership.deleteOne({ _id: membership._id }),
    { code: "ORGANIZATION_MEMBERSHIP_SERVICE_REQUIRED" }
  );
  assert.equal(
    (await OrganizationMembership.findById(membership._id).lean()).status,
    "active"
  );
});

test("replica-set transaction rollback leaves no orphan Organization", async (t) => {
  const actor = await createUser({ platformRole: "platform-admin" });
  const initialOwner = await createUser();
  t.mock.method(OrganizationMembership, "create", async () => {
    throw new Error("forced owner creation failure");
  });

  await assert.rejects(
    createOrganization({
      actor,
      input: {
        name: "Transactional rollback",
        slug: "transactional-rollback",
        initialOwnerUserId: initialOwner._id,
      },
      transactionSupported: true,
    })
  );
  assert.equal(
    await Organization.countDocuments({ slug: "transactional-rollback" }),
    0
  );
});

test("explicit rollback leaves no orphan when transactions are disabled", async (t) => {
  const actor = await createUser({ platformRole: "platform-admin" });
  const initialOwner = await createUser();
  t.mock.method(OrganizationMembership, "create", async () => {
    throw new Error("forced owner creation failure");
  });

  await assert.rejects(
    createOrganization({
      actor,
      input: {
        name: "Explicit rollback",
        slug: "explicit-rollback",
        initialOwnerUserId: initialOwner._id,
      },
      transactionSupported: false,
    })
  );
  assert.equal(
    await Organization.countDocuments({ slug: "explicit-rollback" }),
    0
  );
});

test("hardening audit detects every critical conflict category", async () => {
  await mongoose.connection.dropDatabase();

  const ids = Array.from(
    { length: 15 },
    () => new mongoose.Types.ObjectId()
  );
  const [
    platformUserId,
    customerUserId,
    organizationId,
    ownerlessOrganizationId,
    invalidOrganizationId,
    missingOrganizationId,
    missingUserId,
    companyId,
  ] = ids;
  const now = new Date();

  await User.collection.insertMany([
    {
      _id: platformUserId,
      name: "redacted",
      email: "redacted-1@example.invalid",
      phone: "redacted-1",
      password: "not-used",
      platformRole: "platform-admin",
      isAdmin: true,
    },
    {
      _id: customerUserId,
      name: "redacted",
      email: "redacted-2@example.invalid",
      phone: "redacted-2",
      password: "not-used",
      platformRole: "none",
      isAdmin: false,
    },
  ]);
  await Organization.collection.insertMany([
    {
      _id: organizationId,
      name: "Valid",
      slug: "valid",
      status: "active",
      isActive: false,
    },
    {
      _id: ownerlessOrganizationId,
      name: "Ownerless",
      slug: "ownerless",
      status: "active",
      isActive: true,
    },
    {
      _id: invalidOrganizationId,
      name: "Invalid",
      slug: "invalid",
      status: "unknown",
      isActive: false,
    },
  ]);
  await OrganizationMembership.collection.insertMany([
    {
      _id: ids[8],
      organizationId,
      userId: platformUserId,
      role: "member",
      status: "active",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids[9],
      organizationId,
      userId: platformUserId,
      role: "viewer",
      status: "active",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids[10],
      organizationId: ownerlessOrganizationId,
      userId: customerUserId,
      role: "owner",
      status: "removed",
      isActive: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids[11],
      organizationId,
      userId: missingUserId,
      role: "member",
      status: "active",
      isActive: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids[12],
      organizationId: missingOrganizationId,
      userId: customerUserId,
      role: "member",
      status: "active",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids[13],
      organizationId,
      userId: customerUserId,
      role: "member",
      status: "invalid",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await Company.collection.insertOne({
    _id: companyId,
    name: "Orphan assignment",
    slug: "orphan-assignment",
    ownerUserId: customerUserId,
    organizationId: missingOrganizationId,
  });

  const report = await auditOrganizationHardening();
  assert.equal(report.ok, false);
  assert.equal(
    report.findings.every((finding) => finding.count > 0),
    true,
    JSON.stringify(report, null, 2)
  );
  await assert.rejects(
    runAuditCommand("scripts/auditOrganizationHardening.js"),
    (error) => error.code === 1
  );
});

test("hardening audit succeeds on a clean database", async () => {
  const report = await auditOrganizationHardening();
  assert.equal(report.ok, true);
  assert.equal(report.findings.every((finding) => finding.count === 0), true);
  const command = await runAuditCommand(
    "scripts/auditOrganizationHardening.js"
  );
  assert.equal(JSON.parse(command.stdout).ok, true);
});
