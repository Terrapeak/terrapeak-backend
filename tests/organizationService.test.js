import assert from "node:assert/strict";
import test from "node:test";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import User from "../models/user.js";
import {
  addOrganizationMember,
  assignCompanyToOrganization,
  createOrganization,
  lookupInitialOwner,
  listOrganizationCompanies,
  listOrganizationMembers,
  listPlatformOrganizationMembers,
  removeCompanyFromOrganization,
  removeOrganizationMember,
  updateOrganization,
  updatePlatformOrganization,
  updateOrganizationMember,
} from "../services/organizationService.js";

const ORGANIZATION_ID = "64b000000000000000000001";
const OTHER_ORGANIZATION_ID = "64b000000000000000000002";
const USER_ID = "64b000000000000000000003";
const COMPANY_ID = "64b000000000000000000004";
const MEMBERSHIP_ID = "64b000000000000000000005";

const platformActor = (platformRole = "platform-admin") => ({
  _id: "64b000000000000000000006",
  platformRole,
});

const organization = (overrides = {}) => ({
  _id: ORGANIZATION_ID,
  name: "Example Organization",
  slug: "example-organization",
  status: "active",
  isActive: true,
  ...overrides,
});

const membership = (role, overrides = {}) => ({
  _id: MEMBERSHIP_ID,
  organizationId: ORGANIZATION_ID,
  userId: USER_ID,
  role,
  status: "active",
  isActive: true,
  save: async function save() {
    this.isActive = this.status === "active";
    return this;
  },
  ...overrides,
});

const mockUserLookup = (
  t,
  user = {
    _id: USER_ID,
    name: "Customer User",
    email: "customer@example.com",
    platformRole: "none",
    isApproved: true,
    accountStatus: "active",
  }
) => {
  t.mock.method(User, "findById", () => ({
    select: async () => user,
  }));
};

test("platform admin creates an Organization without an owner", async (t) => {
  let membershipCreateCalled = false;
  t.mock.method(Organization, "create", async (input) => ({
    _id: ORGANIZATION_ID,
    ...input,
  }));
  t.mock.method(OrganizationMembership, "create", async () => {
    membershipCreateCalled = true;
  });

  const result = await createOrganization({
    actor: platformActor(),
    input: { name: "Example", slug: "example" },
  });

  assert.equal(result.organization._id, ORGANIZATION_ID);
  assert.equal(result.initialOwnerMembership, null);
  assert.equal(result.platformManaged, true);
  assert.equal(membershipCreateCalled, false);
});

test("platform admin creates an Organization with a valid initial owner", async (t) => {
  mockUserLookup(t);
  const ownerMembership = membership("owner");
  t.mock.method(Organization, "create", async (input) => ({
    _id: ORGANIZATION_ID,
    ...input,
  }));
  t.mock.method(
    OrganizationMembership,
    "create",
    async (input) => ({ ...ownerMembership, ...input })
  );

  const result = await createOrganization({
    actor: platformActor(),
    input: {
      name: "Example",
      slug: "example",
      initialOwnerUserId: USER_ID,
    },
  });

  assert.equal(result.initialOwnerMembership.role, "owner");
  assert.equal(result.initialOwnerMembership.userId, USER_ID);
  assert.equal(result.platformManaged, false);
});

test("platform admin creates a Distributor with a new initial owner account", async (t) => {
  const owner = {
    _id: USER_ID,
    name: "Distributor Owner",
    email: "owner@example.com",
    phone: "+15551234567",
    platformRole: "none",
    isApproved: true,
    accountStatus: "active",
  };
  const ownerMembership = membership("owner");
  t.mock.method(User, "findOne", async () => null);
  t.mock.method(User, "create", async (input) => ({ ...owner, ...input }));
  t.mock.method(Organization, "create", async (input) => ({
    _id: ORGANIZATION_ID,
    ...input,
  }));
  t.mock.method(
    OrganizationMembership,
    "create",
    async (input) => ({ ...ownerMembership, ...input }),
  );

  const result = await createOrganization({
    actor: platformActor(),
    input: {
      name: "Example Distribution",
      slug: "example-distribution",
      organizationType: "distributor",
      initialOwner: {
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        password: "temporary-password",
      },
    },
    transactionSupported: false,
  });

  assert.equal(result.initialOwnerMembership.role, "owner");
  assert.equal(result.initialOwnerMembership.userId, USER_ID);
  assert.equal(result.initialOwnerMembership.status, "active");
  assert.equal(result.organization.organizationType, "distributor");
  assert.equal(result.initialOwnerUser.platformRole, "none");
});

test("an eligible existing customer user can become a Distributor owner", async (t) => {
  const owner = {
    _id: USER_ID,
    name: "Existing Owner",
    email: "existing@example.com",
    platformRole: "none",
    isApproved: true,
    accountStatus: "active",
    invitationStatus: "not_invited",
    password: "existing-password-hash",
    phone: "+15550000000",
  };
  t.mock.method(User, "findOne", async () => owner);
  mockUserLookup(t, owner);
  t.mock.method(Organization, "create", async (input) => ({
    _id: ORGANIZATION_ID,
    ...input,
  }));
  t.mock.method(OrganizationMembership, "create", async (input) => input);

  const result = await createOrganization({
    actor: platformActor(),
    input: {
      name: "Existing Distribution",
      slug: "existing-distribution",
      organizationType: "distributor",
      initialOwner: { email: owner.email },
    },
    transactionSupported: false,
  });

  assert.equal(result.initialOwnerMembership.userId, USER_ID);
  assert.equal(owner.password, "existing-password-hash");
  assert.equal(owner.name, "Existing Owner");
  assert.equal(owner.phone, "+15550000000");
});

for (const state of [
  { label: "inactive", accountStatus: "suspended", isApproved: true },
  { label: "unapproved", accountStatus: "active", isApproved: false },
  { label: "pending invitation", accountStatus: "active", isApproved: true, invitationStatus: "pending" },
]) {
  test(`${state.label} existing user is rejected as a Distributor owner`, async (t) => {
    t.mock.method(User, "findOne", async () => ({
      _id: USER_ID,
      email: `${state.label.replaceAll(" ", "-")}@example.com`,
      name: "Ineligible User",
      platformRole: "none",
      ...state,
    }));
    t.mock.method(User, "findById", () => ({
      select: async () => ({
        _id: USER_ID,
        email: "ineligible@example.com",
        name: "Ineligible User",
        platformRole: "none",
        ...state,
      }),
    }));

    await assert.rejects(
      () =>
        createOrganization({
          actor: platformActor(),
          input: {
            name: "Ineligible Distribution",
            slug: `ineligible-${state.label.replaceAll(" ", "-")}`,
            organizationType: "distributor",
            initialOwner: { email: "ineligible@example.com" },
          },
        }),
      (error) => error.code === "ORGANIZATION_USER_INELIGIBLE",
    );
  });
}

test("existing Distributor owner does not require a replacement password", async (t) => {
  const owner = {
    _id: USER_ID,
    name: "Existing Owner",
    email: "existing-no-password@example.com",
    phone: "+15550000001",
    password: "unchanged-password-hash",
    platformRole: "none",
    isApproved: true,
    accountStatus: "active",
    invitationStatus: "not_invited",
  };
  t.mock.method(User, "findOne", async () => owner);
  mockUserLookup(t, owner);
  t.mock.method(Organization, "create", async (input) => ({ _id: ORGANIZATION_ID, ...input }));
  t.mock.method(OrganizationMembership, "create", async (input) => input);

  const result = await createOrganization({
    actor: platformActor(),
    input: {
      name: "No Password Distribution",
      slug: "no-password-distribution",
      organizationType: "distributor",
      initialOwner: { email: owner.email },
    },
    transactionSupported: false,
  });

  assert.equal(result.initialOwnerUser.password, "unchanged-password-hash");
  assert.equal(result.initialOwnerUser.name, "Existing Owner");
  assert.equal(result.initialOwnerUser.phone, "+15550000001");
});

test("new Distributor owner requires a valid password", async (t) => {
  t.mock.method(User, "findOne", async () => null);
  await assert.rejects(
    () =>
      createOrganization({
        actor: platformActor(),
        input: {
          name: "Password Distribution",
          slug: "password-distribution",
          organizationType: "distributor",
          initialOwner: {
            name: "New Owner",
            email: "new-owner@example.com",
            phone: "+15550000002",
            password: "short",
          },
        },
      }),
    (error) => error.code === "OWNER_PASSWORD_INVALID",
  );
});

test("a platform owner email is rejected as a Distributor owner", async (t) => {
  const owner = {
    _id: USER_ID,
    email: "platform@example.com",
    platformRole: "platform-admin",
    isApproved: true,
    accountStatus: "active",
  };
  t.mock.method(User, "findOne", async () => owner);

  await assert.rejects(
    () =>
      createOrganization({
        actor: platformActor(),
        input: {
          name: "Blocked Distribution",
          slug: "blocked-distribution",
          organizationType: "distributor",
          initialOwner: { email: owner.email },
        },
      }),
    (error) =>
      error.code === "PLATFORM_USER_NOT_ELIGIBLE" &&
      error.statusCode === 409,
  );
});

test("new Distributor owner is rolled back when membership creation fails", async (t) => {
  const owner = { _id: USER_ID, platformRole: "none" };
  let deletedUserId = null;
  t.mock.method(User, "findOne", async () => null);
  t.mock.method(User, "create", async (input) => ({ ...owner, ...input }));
  t.mock.method(Organization, "create", async (input) => ({
    _id: ORGANIZATION_ID,
    ...input,
  }));
  t.mock.method(OrganizationMembership, "create", async () => {
    throw new Error("membership creation failed");
  });
  t.mock.method(Organization, "deleteOne", async () => ({ deletedCount: 1 }));
  t.mock.method(User, "deleteOne", async ({ _id }) => {
    deletedUserId = _id;
    return { deletedCount: 1 };
  });

  await assert.rejects(() =>
    createOrganization({
      actor: platformActor(),
      input: {
        name: "Rollback Distribution",
        slug: "rollback-distribution",
        organizationType: "distributor",
        initialOwner: {
          name: "Rollback Owner",
          email: "rollback@example.com",
          phone: "+15551234567",
          password: "temporary-password",
        },
      },
      transactionSupported: false,
    }),
  );
  assert.equal(deletedUserId, USER_ID);
});

test("rollback never deletes an existing reused owner", async (t) => {
  const owner = {
    _id: USER_ID,
    email: "reused-owner@example.com",
    name: "Reused Owner",
    phone: "+15550000003",
    platformRole: "none",
    isApproved: true,
    accountStatus: "active",
    invitationStatus: "not_invited",
  };
  let deletedUser = false;
  t.mock.method(User, "findOne", async () => owner);
  mockUserLookup(t, owner);
  t.mock.method(Organization, "create", async (input) => ({ _id: ORGANIZATION_ID, ...input }));
  t.mock.method(OrganizationMembership, "create", async () => {
    throw new Error("membership creation failed");
  });
  t.mock.method(Organization, "deleteOne", async () => ({ deletedCount: 1 }));
  t.mock.method(User, "deleteOne", async () => {
    deletedUser = true;
    return { deletedCount: 1 };
  });

  await assert.rejects(() =>
    createOrganization({
      actor: platformActor(),
      input: {
        name: "Reused Distribution",
        slug: "reused-distribution",
        organizationType: "distributor",
        initialOwner: { email: owner.email },
      },
      transactionSupported: false,
    }),
  );
  assert.equal(deletedUser, false);
});

test("duplicate owner membership is returned as a clear conflict", async (t) => {
  mockUserLookup(t);
  t.mock.method(Organization, "create", async (input) => ({ _id: ORGANIZATION_ID, ...input }));
  t.mock.method(OrganizationMembership, "create", async () => {
    const error = new Error("duplicate membership");
    error.code = 11000;
    error.keyPattern = { organizationId: 1, userId: 1 };
    throw error;
  });
  t.mock.method(Organization, "deleteOne", async () => ({ deletedCount: 1 }));

  await assert.rejects(
    () =>
      createOrganization({
        actor: platformActor(),
        input: {
          name: "Duplicate Distribution",
          slug: "duplicate-distribution",
          organizationType: "distributor",
          initialOwnerUserId: USER_ID,
        },
        transactionSupported: false,
      }),
    (error) => error.code === "ORGANIZATION_MEMBERSHIP_EXISTS",
  );
});

for (const organizationType of ["direct_customer", "enterprise_group"]) {
  test(`${organizationType} creation remains ownerless-compatible`, async (t) => {
    t.mock.method(Organization, "create", async (input) => ({ _id: ORGANIZATION_ID, ...input }));
    const result = await createOrganization({
      actor: platformActor("platform-owner"),
      input: {
        name: `${organizationType} Example`,
        slug: `${organizationType}-example`,
        organizationType,
      },
    });
    assert.equal(result.organization.organizationType, organizationType);
    assert.equal(result.initialOwnerMembership, null);
  });
}

test("Organization creation rolls back when initial owner creation fails", async (t) => {
  mockUserLookup(t);
  let rolledBackId = null;
  t.mock.method(Organization, "create", async () => ({
    _id: ORGANIZATION_ID,
  }));
  t.mock.method(OrganizationMembership, "create", async () => {
    throw new Error("membership creation failed");
  });
  t.mock.method(Organization, "deleteOne", async (filter) => {
    rolledBackId = filter._id;
    return { deletedCount: 1 };
  });

  await assert.rejects(() =>
    createOrganization({
      actor: platformActor(),
      input: {
        name: "Example",
        slug: "example",
        initialOwnerUserId: USER_ID,
      },
    })
  );
  assert.equal(rolledBackId, ORGANIZATION_ID);
});

test("duplicate Organization slug returns a safe conflict", async (t) => {
  t.mock.method(Organization, "create", async () => {
    const error = new Error("duplicate");
    error.code = 11000;
    throw error;
  });

  await assert.rejects(
    () =>
      createOrganization({
        actor: platformActor(),
        input: { name: "Example", slug: "duplicate" },
      }),
    (error) =>
      error.statusCode === 409 &&
      error.code === "ORGANIZATION_SLUG_CONFLICT"
  );
});

test("non-administrative platform role cannot manage Organizations", async () => {
  await assert.rejects(
    () =>
      createOrganization({
        actor: platformActor("support-admin"),
        input: { name: "Example", slug: "example" },
      }),
    (error) => error.code === "PLATFORM_ROLE_REQUIRED"
  );
});

for (const actor of [null, { _id: USER_ID, platformRole: "none" }]) {
  test("unauthenticated or normal dashboard users cannot create Organizations", async () => {
    await assert.rejects(
      () =>
        createOrganization({
          actor,
          input: { name: "Blocked Organization", slug: "blocked-organization" },
        }),
      (error) => error.code === "PLATFORM_ROLE_REQUIRED",
    );
  });
}

test("owner lookup exposes only non-sensitive eligibility details", async (t) => {
  t.mock.method(User, "findOne", () => ({
    select: async () => ({
      name: "Lookup User",
      email: "lookup@example.com",
      platformRole: "none",
      isApproved: true,
      accountStatus: "active",
      password: "secret-hash",
    }),
  }));
  const result = await lookupInitialOwner({ email: "lookup@example.com" });
  assert.deepEqual(result, {
    exists: true,
    eligible: true,
    user: { name: "Lookup User", email: "lookup@example.com" },
    reason: null,
  });
  assert.equal("password" in result, false);
});

test("Organization owner and admin may update Organization fields", async () => {
  for (const role of ["owner", "admin"]) {
    const target = organization({
      save: async function save() {
        return this;
      },
    });
    await updateOrganization({
      organization: target,
      membership: membership(role),
      updates: { name: `${role} update`, metadata: { role } },
    });
    assert.equal(target.name, `${role} update`);
    assert.deepEqual(target.metadata, { role });
  }
});

test("platform Organization creation rejects invalid structural types", async () => {
  for (const organizationType of ["invalid", "Distributor", "", null]) {
    await assert.rejects(
      () =>
        createOrganization({
          actor: platformActor(),
          input: { name: "Example", slug: "example", organizationType },
          transactionSupported: false,
        }),
      (error) => error.code === "INVALID_ORGANIZATION_TYPE",
    );
  }
});

test("Organization admins cannot change structural Organization type", async () => {
  const target = organization({
    save: async function save() {
      return this;
    },
  });

  await updateOrganization({
    organization: target,
    membership: membership("admin"),
    updates: { organizationType: "distributor" },
  });

  assert.equal(target.organizationType, undefined);
});

test("platform admins can change structural Organization type", async (t) => {
  const target = organization({
    organizationType: "direct_customer",
    save: async function save() {
      return this;
    },
  });
  t.mock.method(Organization, "findById", async () => target);

  const result = await updatePlatformOrganization({
    actor: platformActor("platform-owner"),
    organizationId: ORGANIZATION_ID,
    updates: { organizationType: "distributor" },
  });

  assert.equal(result.organizationType, "distributor");
});

for (const role of ["manager", "member", "viewer"]) {
  test(`${role} Organization role remains read-only`, async () => {
    await assert.rejects(
      () =>
        updateOrganization({
          organization: organization(),
          membership: membership(role),
          updates: { name: "Forbidden" },
        }),
      (error) => error.code === "ORGANIZATION_ROLE_REQUIRED"
    );
  });
}

test("Organization admin cannot assign or modify owner role", async (t) => {
  const target = membership("owner");
  t.mock.method(OrganizationMembership, "findOne", async () => target);

  await assert.rejects(
    () =>
      updateOrganizationMember({
        organization: organization(),
        actorMembership: membership("admin", {
          _id: "64b000000000000000000007",
        }),
        membershipId: MEMBERSHIP_ID,
        updates: { role: "manager" },
      }),
    (error) => error.code === "ORGANIZATION_ROLE_REQUIRED"
  );
});

test("Organization admin cannot add an owner", async () => {
  await assert.rejects(
    () =>
      addOrganizationMember({
        organization: organization(),
        actorMembership: membership("admin"),
        input: { userId: USER_ID, role: "owner" },
      }),
    (error) => error.code === "ORGANIZATION_ROLE_REQUIRED"
  );
});

test("Organization manager may list members", async (t) => {
  const members = [membership("member")];
  t.mock.method(OrganizationMembership, "find", (filter) => {
    assert.deepEqual(filter, {
      organizationId: ORGANIZATION_ID,
      status: { $ne: "removed" },
    });
    return {
      populate: () => ({
        sort: async () => members,
      }),
    };
  });

  const result = await listOrganizationMembers({
    organization: organization(),
    membership: membership("manager"),
  });
  assert.equal(result, members);
});

test("platform Organization member listing is scoped, safe, and sorted with removed members", async (t) => {
  const members = [
    {
      _id: "64b000000000000000000009",
      organizationId: ORGANIZATION_ID,
      userId: {
        _id: "64b000000000000000000010",
        name: "Member User",
        email: "member@example.com",
        password: "never-returned",
        resetTokenHash: "never-returned",
      },
      role: "member",
      status: "active",
      isActive: true,
    },
    {
      _id: "64b000000000000000000011",
      organizationId: ORGANIZATION_ID,
      userId: {
        _id: "64b000000000000000000012",
        name: "Former Owner",
        email: "former@example.com",
        oauthTokens: "never-returned",
      },
      role: "member",
      status: "removed",
      isActive: false,
    },
    {
      _id: "64b000000000000000000013",
      organizationId: ORGANIZATION_ID,
      userId: {
        _id: "64b000000000000000000014",
        name: "Current Owner",
        email: "owner@example.com",
      },
      role: "owner",
      status: "active",
      isActive: true,
    },
  ];
  t.mock.method(Organization, "findById", async () => organization());
  t.mock.method(OrganizationMembership, "find", (filter) => {
    assert.deepEqual(filter, { organizationId: ORGANIZATION_ID });
    return {
      populate: (path, select) => {
        assert.equal(path, "userId");
        assert.equal(select, "_id name email");
        return { sort: async () => members };
      },
    };
  });

  const result = await listPlatformOrganizationMembers({
    actor: platformActor(),
    organizationId: ORGANIZATION_ID,
  });

  assert.deepEqual(result.map((entry) => entry.role), ["owner", "member", "member"]);
  assert.equal(result[1].status, "removed");
  assert.equal(result[0].userId.name, "Current Owner");
  assert.equal(result[2].userId.email, "member@example.com");
});

test("platform Organization member listing rejects non-platform users", async () => {
  await assert.rejects(
    () =>
      listPlatformOrganizationMembers({
        actor: { _id: USER_ID, platformRole: "none" },
        organizationId: ORGANIZATION_ID,
      }),
    (error) => error.code === "PLATFORM_ROLE_REQUIRED",
  );
});

test("final active Organization owner cannot be removed", async (t) => {
  const target = membership("owner");
  t.mock.method(OrganizationMembership, "findOne", (filter) => {
    if (filter._id === MEMBERSHIP_ID) return Promise.resolve(target);
    return {
      select: async () => null,
    };
  });

  await assert.rejects(
    () =>
      removeOrganizationMember({
        organization: organization(),
        actorMembership: membership("owner", {
          _id: "64b000000000000000000007",
        }),
        membershipId: MEMBERSHIP_ID,
      }),
    (error) => error.code === "ORGANIZATION_FINAL_OWNER_REQUIRED"
  );
  assert.equal(target.status, "active");
});

test("final active Organization owner cannot be deactivated", async (t) => {
  const target = membership("owner");
  mockUserLookup(t);
  t.mock.method(OrganizationMembership, "findOne", (filter) => {
    if (filter._id === MEMBERSHIP_ID) return Promise.resolve(target);
    return {
      select: async () => null,
    };
  });

  await assert.rejects(
    () =>
      updateOrganizationMember({
        organization: organization(),
        actorMembership: membership("owner", {
          _id: "64b000000000000000000007",
        }),
        membershipId: MEMBERSHIP_ID,
        updates: { status: "inactive" },
      }),
    (error) => error.code === "ORGANIZATION_FINAL_OWNER_REQUIRED"
  );
  assert.equal(target.status, "active");
});

test("platform-role conflict is rejected when adding a member", async (t) => {
  mockUserLookup(t, {
    _id: USER_ID,
    platformRole: "platform-admin",
    isApproved: true,
    accountStatus: "active",
  });

  await assert.rejects(
    () =>
      addOrganizationMember({
        organization: organization(),
        actorMembership: membership("owner"),
        input: { userId: USER_ID, role: "member" },
      }),
    (error) => error.code === "PLATFORM_ORGANIZATION_ROLE_CONFLICT"
  );
});

test("Organization role assignment never changes platform authority", async (t) => {
  const user = {
    _id: USER_ID,
    platformRole: "none",
    isAdmin: false,
    isApproved: true,
    accountStatus: "active",
  };
  mockUserLookup(t, user);
  t.mock.method(OrganizationMembership, "findOne", () => ({
    select: async () => null,
  }));
  t.mock.method(OrganizationMembership, "create", async (input) => ({
    _id: MEMBERSHIP_ID,
    ...input,
  }));

  const created = await addOrganizationMember({
    organization: organization(),
    actorMembership: membership("owner"),
    input: { userId: USER_ID, role: "admin" },
  });

  assert.equal(created.role, "admin");
  assert.equal(user.platformRole, "none");
  assert.equal(user.isAdmin, false);
});

test("owner attaches an unassigned Company", async (t) => {
  let saveCount = 0;
  const company = {
    _id: COMPANY_ID,
    organizationId: null,
    save: async () => {
      saveCount += 1;
    },
  };
  t.mock.method(Company, "findById", async () => company);
  t.mock.method(CompanyMembership, "findOne", (filter) => {
    assert.deepEqual(filter, {
      companyId: COMPANY_ID,
      userId: USER_ID,
      status: "active",
      role: { $in: ["owner", "admin"] },
    });
    return { select: async () => ({ _id: MEMBERSHIP_ID }) };
  });

  await assignCompanyToOrganization({
    organization: organization(),
    companyId: COMPANY_ID,
    actorMembership: membership("owner"),
  });

  assert.equal(String(company.organizationId), ORGANIZATION_ID);
  assert.equal(saveCount, 1);
});

test("distributor owner cannot self-attach an unassigned Company", async () => {
  await assert.rejects(
    () =>
      assignCompanyToOrganization({
        organization: organization({ organizationType: "distributor" }),
        companyId: COMPANY_ID,
        actorMembership: membership("owner"),
      }),
    (error) => error.code === "ORGANIZATION_COMPANY_SELF_SERVICE_DISABLED",
  );
});

test("Company assigned to another Organization is rejected", async (t) => {
  t.mock.method(Company, "findById", async () => ({
    _id: COMPANY_ID,
    organizationId: OTHER_ORGANIZATION_ID,
    save: async () => assert.fail("save should not be called"),
  }));

  await assert.rejects(
    () =>
      assignCompanyToOrganization({
        organization: organization(),
        companyId: COMPANY_ID,
        actorMembership: membership("admin"),
      }),
    (error) => error.code === "COMPANY_ALREADY_ASSIGNED"
  );
});

test("platform admin attaches an unassigned Company without customer membership", async (t) => {
  let companyMembershipLookupCalled = false;
  const company = {
    _id: COMPANY_ID,
    organizationId: null,
    save: async () => company,
  };
  t.mock.method(Company, "findById", async () => company);
  t.mock.method(CompanyMembership, "findOne", () => {
    companyMembershipLookupCalled = true;
  });

  await assignCompanyToOrganization({
    organization: organization(),
    companyId: COMPANY_ID,
    platformActor: platformActor(),
  });

  assert.equal(String(company.organizationId), ORGANIZATION_ID);
  assert.equal(companyMembershipLookupCalled, false);
});

test("detaching a Company clears organizationId without deleting it", async (t) => {
  let saveCount = 0;
  const company = {
    _id: COMPANY_ID,
    organizationId: ORGANIZATION_ID,
    save: async () => {
      saveCount += 1;
    },
  };
  t.mock.method(Company, "findById", async () => company);
  t.mock.method(CompanyMembership, "findOne", () => ({
    select: async () => ({ _id: MEMBERSHIP_ID }),
  }));

  await removeCompanyFromOrganization({
    organization: organization(),
    companyId: COMPANY_ID,
    actorMembership: membership("owner"),
  });

  assert.equal(company.organizationId, null);
  assert.equal(saveCount, 1);
});

test("distributor owner cannot self-detach a Company", async () => {
  await assert.rejects(
    () =>
      removeCompanyFromOrganization({
        organization: organization({ organizationType: "distributor" }),
        companyId: COMPANY_ID,
        actorMembership: membership("owner"),
      }),
    (error) => error.code === "ORGANIZATION_COMPANY_SELF_SERVICE_DISABLED",
  );
});

test("Organization role alone cannot claim an unassigned Company", async (t) => {
  t.mock.method(Company, "findById", async () => ({
    _id: COMPANY_ID,
    organizationId: null,
    save: async () => assert.fail("save should not be called"),
  }));
  t.mock.method(CompanyMembership, "findOne", () => ({
    select: async () => null,
  }));

  await assert.rejects(
    () =>
      assignCompanyToOrganization({
        organization: organization(),
        companyId: COMPANY_ID,
        actorMembership: membership("owner"),
      }),
    (error) => error.code === "COMPANY_ACCESS_DENIED"
  );
});

test("Company listing is strictly filtered by Organization", async (t) => {
  const companies = [{ _id: COMPANY_ID, organizationId: ORGANIZATION_ID }];
  t.mock.method(Company, "find", (filter) => {
    assert.deepEqual(filter, {
      organizationId: ORGANIZATION_ID,
      isActive: { $ne: false },
      lifecycleStatus: { $ne: "archived" },
    });
    return {
      sort: async () => companies,
    };
  });

  const result = await listOrganizationCompanies({
    organization: organization(),
    membership: membership("viewer"),
  });
  assert.equal(result, companies);
});

test("cross-Organization Company detach is rejected", async (t) => {
  t.mock.method(Company, "findById", async () => ({
    _id: COMPANY_ID,
    organizationId: OTHER_ORGANIZATION_ID,
    save: async () => assert.fail("save should not be called"),
  }));

  await assert.rejects(
    () =>
      removeCompanyFromOrganization({
        organization: organization(),
        companyId: COMPANY_ID,
        actorMembership: membership("owner"),
      }),
    (error) => error.code === "ORGANIZATION_ACCESS_DENIED"
  );
});
