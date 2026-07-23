import assert from "node:assert/strict";
import test from "node:test";

import Company from "../models/company.js";
import Organization, {
  normalizeOrganizationUpdate,
  synchronizeOrganizationDocument,
} from "../models/organization.js";
import OrganizationMembership, {
  normalizeOrganizationMembershipUpdate,
  synchronizeOrganizationMembershipDocument,
  validateOrganizationMembershipReferences,
} from "../models/organizationMembership.js";
import User from "../models/user.js";
import { ORGANIZATION_ROLES } from "../utils/roleSeparation.js";

const ORGANIZATION_ID = "64b000000000000000000001";
const USER_ID = "64b000000000000000000002";
const INVITER_ID = "64b000000000000000000003";

const hasIndex = (schema, keys, expectedOptions = {}) =>
  schema.indexes().some(([indexKeys, options]) => {
    try {
      assert.deepEqual(indexKeys, keys);
      for (const [option, value] of Object.entries(expectedOptions)) {
        assert.deepEqual(options[option], value);
      }
      return true;
    } catch {
      return false;
    }
  });

const hydratedOrganization = (state) =>
  Organization.hydrate({
    _id: ORGANIZATION_ID,
    name: "Example Organization",
    slug: "example-organization",
    ...state,
  });

const hydratedMembership = (state) =>
  OrganizationMembership.hydrate({
    _id: "64b000000000000000000004",
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "member",
    ...state,
  });

const mockReferenceModels = ({
  organizationExists = true,
  user = { _id: USER_ID, platformRole: "none" },
} = {}) => ({
  OrganizationModel: {
    exists: async () =>
      organizationExists ? { _id: ORGANIZATION_ID } : null,
  },
  UserModel: {
    findById: () => ({
      select: async () => user,
    }),
  },
});

test("Organization accepts valid data and normalizes name and slug", () => {
  const organization = new Organization({
    name: "  Example Organization  ",
    slug: "  EXAMPLE-ORG  ",
    createdByUserId: USER_ID,
    metadata: { source: "phase-3a" },
  });

  assert.equal(organization.validateSync(), undefined);
  assert.equal(organization.name, "Example Organization");
  assert.equal(organization.slug, "example-org");
  assert.equal(organization.status, "active");
  assert.equal(organization.isActive, true);
  assert.deepEqual(organization.metadata, { source: "phase-3a" });
});

test("Organization declares a unique slug and status index", () => {
  assert.equal(
    hasIndex(Organization.schema, { slug: 1 }, { unique: true }),
    true
  );
  assert.equal(hasIndex(Organization.schema, { status: 1 }), true);
});

test("Organization status derives isActive", () => {
  const active = hydratedOrganization({
    status: "inactive",
    isActive: false,
  });
  active.status = "active";
  synchronizeOrganizationDocument(active);

  const inactive = hydratedOrganization({
    status: "active",
    isActive: true,
  });
  inactive.status = "inactive";
  synchronizeOrganizationDocument(inactive);

  assert.equal(active.isActive, true);
  assert.equal(inactive.isActive, false);
});

test("explicit isActive false deactivates an active Organization", () => {
  const organization = hydratedOrganization({
    status: "active",
    isActive: true,
  });

  organization.isActive = false;
  synchronizeOrganizationDocument(organization);

  assert.equal(organization.status, "inactive");
  assert.equal(organization.isActive, false);
});

test("archived Organization cannot be reactivated through isActive alone", () => {
  const organization = hydratedOrganization({
    status: "archived",
    isActive: false,
  });

  organization.isActive = true;
  synchronizeOrganizationDocument(organization);

  assert.equal(organization.status, "archived");
  assert.equal(organization.isActive, false);
});

test("Organization query updates normalize canonical state", () => {
  assert.deepEqual(
    normalizeOrganizationUpdate({ $set: { status: "active" } }),
    { $set: { status: "active", isActive: true } }
  );
  assert.deepEqual(
    normalizeOrganizationUpdate({
      status: "active",
      isActive: false,
    }),
    { $set: { status: "inactive", isActive: false } }
  );
  assert.deepEqual(
    normalizeOrganizationUpdate({
      status: "archived",
      isActive: true,
    }),
    { $set: { status: "archived", isActive: false } }
  );
  assert.throws(
    () => normalizeOrganizationUpdate({ $set: { isActive: true } }),
    /must set status instead of isActive/
  );
});

test("OrganizationMembership accepts every required role", () => {
  assert.deepEqual(ORGANIZATION_ROLES, [
    "owner",
    "admin",
    "manager",
    "member",
    "viewer",
  ]);

  for (const role of ORGANIZATION_ROLES) {
    const membership = new OrganizationMembership({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      role,
      invitedByUserId: INVITER_ID,
    });
    assert.equal(membership.validateSync(), undefined);
  }
});

test("OrganizationMembership rejects invalid and platform-only roles", () => {
  for (const role of ["staff", "platform-admin", "support-admin"]) {
    const membership = new OrganizationMembership({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      role,
    });
    const error = membership.validateSync();

    assert.equal(error?.errors.role?.kind, "enum");
  }
});

test("OrganizationMembership validates references and a non-platform user", async () => {
  const membership = new OrganizationMembership({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "admin",
  });

  await validateOrganizationMembershipReferences(
    membership,
    mockReferenceModels()
  );
});

test("OrganizationMembership rejects a platform user assignment", async () => {
  const membership = new OrganizationMembership({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "admin",
  });

  await assert.rejects(
    () =>
      validateOrganizationMembershipReferences(
        membership,
        mockReferenceModels({
          user: { _id: USER_ID, platformRole: "platform-admin" },
        })
      ),
    (error) => error.code === "PLATFORM_ORGANIZATION_ROLE_CONFLICT"
  );
});

test("OrganizationMembership validation hook enforces platform separation", async (t) => {
  t.mock.method(Organization, "exists", async () => ({
    _id: ORGANIZATION_ID,
  }));
  t.mock.method(User, "findById", () => ({
    select: async () => ({
      _id: USER_ID,
      platformRole: "billing-admin",
    }),
  }));

  const membership = new OrganizationMembership({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "viewer",
  });

  await assert.rejects(
    () => membership.validate(),
    (error) => error.code === "PLATFORM_ORGANIZATION_ROLE_CONFLICT"
  );
});

test("OrganizationMembership rejects missing referenced records", async () => {
  const membership = new OrganizationMembership({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "member",
  });

  await assert.rejects(
    () =>
      validateOrganizationMembershipReferences(
        membership,
        mockReferenceModels({ organizationExists: false })
      ),
    (error) => error.code === "ORGANIZATION_NOT_FOUND"
  );
  await assert.rejects(
    () =>
      validateOrganizationMembershipReferences(
        membership,
        mockReferenceModels({ user: null })
      ),
    (error) => error.code === "USER_NOT_FOUND"
  );
});

test("OrganizationMembership declares unique pair and lookup indexes", () => {
  assert.equal(
    hasIndex(
      OrganizationMembership.schema,
      { organizationId: 1, userId: 1 },
      { unique: true }
    ),
    true
  );
  assert.equal(
    hasIndex(OrganizationMembership.schema, {
      organizationId: 1,
      status: 1,
    }),
    true
  );
  assert.equal(
    hasIndex(OrganizationMembership.schema, {
      userId: 1,
      status: 1,
    }),
    true
  );
});

test("OrganizationMembership status derives isActive", () => {
  const active = hydratedMembership({
    status: "inactive",
    isActive: false,
  });
  active.status = "active";
  synchronizeOrganizationMembershipDocument(active);

  const inactive = hydratedMembership({
    status: "active",
    isActive: true,
  });
  inactive.status = "inactive";
  synchronizeOrganizationMembershipDocument(inactive);

  assert.equal(active.isActive, true);
  assert.equal(inactive.isActive, false);
});

test("removed OrganizationMembership cannot be restored through isActive", () => {
  const membership = hydratedMembership({
    status: "removed",
    isActive: false,
  });

  membership.isActive = true;
  synchronizeOrganizationMembershipDocument(membership);

  assert.equal(membership.status, "removed");
  assert.equal(membership.isActive, false);
});

test("OrganizationMembership query updates normalize canonical state", () => {
  assert.deepEqual(
    normalizeOrganizationMembershipUpdate({
      $set: { status: "active" },
    }),
    { $set: { status: "active", isActive: true } }
  );
  assert.deepEqual(
    normalizeOrganizationMembershipUpdate({
      status: "active",
      isActive: false,
    }),
    { $set: { status: "inactive", isActive: false } }
  );
  assert.deepEqual(
    normalizeOrganizationMembershipUpdate({
      status: "removed",
      isActive: true,
    }),
    { $set: { status: "removed", isActive: false } }
  );
  assert.throws(
    () =>
      normalizeOrganizationMembershipUpdate({
        $set: { isActive: false },
      }),
    /must set status instead of isActive/
  );
});

test("Company organizationId is optional and indexed", () => {
  const path = Company.schema.path("organizationId");

  assert.equal(path.options.ref, "Organization");
  assert.equal(path.options.default, null);
  assert.equal(path.options.required, undefined);
  assert.equal(path.options.index, true);
});

test("Company stores a valid Organization reference", () => {
  const company = new Company({
    name: "Organization Company",
    slug: "organization-company",
    ownerUserId: USER_ID,
    organizationId: ORGANIZATION_ID,
  });

  assert.equal(company.validateSync(), undefined);
  assert.equal(String(company.organizationId), ORGANIZATION_ID);
});

test("legacy Company creation remains valid with organizationId null", () => {
  const company = new Company({
    name: "Legacy Company",
    slug: "legacy-company",
    ownerUserId: USER_ID,
  });

  assert.equal(company.validateSync(), undefined);
  assert.equal(company.organizationId, null);
});
