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
  listOrganizationCompanies,
  listOrganizationMembers,
  removeCompanyFromOrganization,
  removeOrganizationMember,
  updateOrganization,
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
    assert.deepEqual(filter, { organizationId: ORGANIZATION_ID });
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
