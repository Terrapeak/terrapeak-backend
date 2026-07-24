import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import Contract from "../models/contract.js";
import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import User from "../models/user.js";
import onboardCustomerEnvironment from "../services/customerOnboardingService.js";

let replicaSet;
let sequence = 0;

const nextValue = (prefix) => `${prefix}-${++sequence}`;

const syncIndexes = async () => {
  await User.syncIndexes();
  await Organization.syncIndexes();
  await OrganizationMembership.syncIndexes();
  await Company.syncIndexes();
  await CompanyMembership.syncIndexes();
  await Contract.syncIndexes();
};

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  await mongoose.connect(replicaSet.getUri(), {
    dbName: "customer-onboarding-integration",
  });
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await syncIndexes();
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet?.stop();
});

test("customer onboarding creates a fully separated organization and company structure", async () => {
  const slug = nextValue("customer");
  const email = `${slug}@example.com`;

  const result = await onboardCustomerEnvironment({
    owner: {
      name: "Customer Owner",
      email,
      phone: "+60123456789",
      password: "temporary-password-123",
      country: "MY",
    },
    company: {
      name: "Customer Company",
      slug,
      organizationSlug: `${slug}-organization`,
      referencePrefix: "CC",
      plan: "starter",
      maxUsers: 3,
    },
    installedApps: [],
  });

  const [user, organization, organizationMembership, company, membership] =
    await Promise.all([
      User.findById(result.user._id).lean(),
      Organization.findById(result.organization._id).lean(),
      OrganizationMembership.findById(
        result.organizationMembership._id
      ).lean(),
      Company.findById(result.company._id).lean(),
      CompanyMembership.findById(result.membership._id).lean(),
    ]);

  assert.equal(user.email, email);
  assert.equal(user.platformRole, "none");
  assert.equal(user.accountStatus, "active");
  assert.equal(user.isApproved, true);

  assert.equal(organization.status, "active");
  assert.equal(organization.isActive, true);
  assert.equal(String(organization.createdByUserId), String(user._id));

  assert.equal(
    String(organizationMembership.organizationId),
    String(organization._id)
  );
  assert.equal(String(organizationMembership.userId), String(user._id));
  assert.equal(organizationMembership.role, "owner");
  assert.equal(organizationMembership.status, "active");
  assert.equal(organizationMembership.isActive, true);

  assert.equal(String(company.organizationId), String(organization._id));
  assert.equal(String(company.ownerUserId), String(user._id));
  assert.equal(company.isPlatformWorkspace, false);
  assert.equal(company.isActive, true);

  assert.equal(String(membership.companyId), String(company._id));
  assert.equal(String(membership.userId), String(user._id));
  assert.equal(membership.role, "owner");
  assert.equal(membership.status, "active");
  assert.equal(membership.isActive, true);

  assert.equal(await Contract.countDocuments({ companyId: company._id }), 1);
  assert.deepEqual(result.installedApps, []);
  assert.deepEqual(result.validation, {
    userReady: true,
    organizationReady: true,
    organizationMembershipReady: true,
    companyReady: true,
    membershipReady: true,
    aiAssistantReady: null,
  });
});

test("customer onboarding rejects a Platform user as the customer owner", async () => {
  const email = `${nextValue("platform-user")}@example.com`;

  await User.create({
    name: "Platform User",
    email,
    phone: "+60111111111",
    password: "temporary-password-123",
    platformRole: "platform-admin",
    isAdmin: false,
    isApproved: true,
    accountStatus: "active",
  });

  await assert.rejects(
    onboardCustomerEnvironment({
      owner: {
        name: "Platform User",
        email,
        phone: "+60111111111",
        password: "temporary-password-123",
        country: "MY",
      },
      company: {
        name: "Invalid Customer Company",
        slug: nextValue("invalid-customer"),
      },
      installedApps: [],
    }),
    /Platform user cannot be assigned as a customer organization owner/
  );

  assert.equal(await Organization.countDocuments(), 0);
  assert.equal(await Company.countDocuments(), 0);
});

test("rerunning onboarding reuses the same customer structure", async () => {
  const slug = nextValue("repeat-customer");
  const input = {
    owner: {
      name: "Repeat Owner",
      email: `${slug}@example.com`,
      phone: "+60222222222",
      password: "temporary-password-123",
      country: "MY",
    },
    company: {
      name: "Repeat Customer",
      slug,
      organizationSlug: `${slug}-organization`,
      referencePrefix: "RC",
    },
    installedApps: [],
  };

  const first = await onboardCustomerEnvironment(input);
  const second = await onboardCustomerEnvironment(input);

  assert.equal(String(first.user._id), String(second.user._id));
  assert.equal(String(first.organization._id), String(second.organization._id));
  assert.equal(String(first.company._id), String(second.company._id));
  assert.equal(String(first.membership._id), String(second.membership._id));

  assert.equal(await User.countDocuments(), 1);
  assert.equal(await Organization.countDocuments(), 1);
  assert.equal(await OrganizationMembership.countDocuments(), 1);
  assert.equal(await Company.countDocuments(), 1);
  assert.equal(await CompanyMembership.countDocuments(), 1);
  assert.equal(await Contract.countDocuments(), 1);
});
