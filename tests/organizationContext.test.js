import assert from "node:assert/strict";
import test from "node:test";

import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import User from "../models/user.js";
import resolveOrganizationContext, {
  requireOrganizationMembership,
  requireOrganizationRole,
} from "../middleware/resolveOrganizationContext.js";

const ORGANIZATION_ID = "64b000000000000000000001";
const USER_ID = "64b000000000000000000002";

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const createRequest = ({
  organizationId = ORGANIZATION_ID,
  headerOrganizationId,
} = {}) => ({
  userId: USER_ID,
  params: organizationId ? { organizationId } : {},
  get: (name) =>
    name === "x-organization-id" ? headerOrganizationId : undefined,
});

const mockUser = (t, overrides = {}) => {
  t.mock.method(User, "findById", (userId) => {
    assert.equal(userId, USER_ID);
    return {
      select: async () => ({
        _id: USER_ID,
        platformRole: "none",
        isApproved: true,
        ...overrides,
      }),
    };
  });
};

test("resolveOrganizationContext attaches explicit route context", async (t) => {
  mockUser(t);
  const organization = {
    _id: ORGANIZATION_ID,
    status: "active",
    name: "Organization",
  };
  const membership = {
    _id: "64b000000000000000000003",
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "owner",
    status: "active",
  };

  t.mock.method(Organization, "findById", async (organizationId) => {
    assert.equal(organizationId, ORGANIZATION_ID);
    return organization;
  });
  t.mock.method(OrganizationMembership, "findOne", async (filter) => {
    assert.deepEqual(filter, {
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      status: "active",
    });
    return membership;
  });

  const req = createRequest();
  const res = createResponse();
  let nextCalled = false;

  await resolveOrganizationContext(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.organization, organization);
  assert.equal(req.organizationMembership, membership);
});

test("resolveOrganizationContext accepts an explicit header context", async (t) => {
  mockUser(t);
  t.mock.method(Organization, "findById", async () => ({
    _id: ORGANIZATION_ID,
    status: "active",
  }));
  t.mock.method(OrganizationMembership, "findOne", async () => ({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "viewer",
    status: "active",
  }));

  const req = createRequest({
    organizationId: null,
    headerOrganizationId: ORGANIZATION_ID,
  });
  let nextCalled = false;

  await resolveOrganizationContext(req, createResponse(), () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test("multiple memberships never trigger a first-membership fallback", async (t) => {
  let membershipLookupCalled = false;
  t.mock.method(OrganizationMembership, "findOne", async () => {
    membershipLookupCalled = true;
    return {
      organizationId: ORGANIZATION_ID,
      status: "active",
    };
  });

  const res = createResponse();
  await resolveOrganizationContext(
    createRequest({ organizationId: null }),
    res,
    () => assert.fail("next should not be called")
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "ORGANIZATION_CONTEXT_REQUIRED");
  assert.equal(membershipLookupCalled, false);
});

test("inactive Organization is rejected", async (t) => {
  mockUser(t);
  t.mock.method(Organization, "findById", async () => ({
    _id: ORGANIZATION_ID,
    status: "inactive",
  }));

  const res = createResponse();
  await resolveOrganizationContext(createRequest(), res, () => {
    assert.fail("next should not be called");
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "ORGANIZATION_INACTIVE");
});

for (const membershipStatus of ["inactive", "removed"]) {
  test(`${membershipStatus} Organization membership is rejected`, async (t) => {
    mockUser(t);
    t.mock.method(Organization, "findById", async () => ({
      _id: ORGANIZATION_ID,
      status: "active",
    }));
    t.mock.method(OrganizationMembership, "findOne", async (filter) => {
      assert.equal(filter.status, "active");
      return null;
    });

    const res = createResponse();
    await resolveOrganizationContext(createRequest(), res, () => {
      assert.fail("next should not be called");
    });

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "ORGANIZATION_ACCESS_DENIED");
  });
}

test("platform user is rejected from Organization context", async (t) => {
  mockUser(t, { platformRole: "platform-admin" });
  let organizationLookupCalled = false;
  t.mock.method(Organization, "findById", async () => {
    organizationLookupCalled = true;
  });

  const res = createResponse();
  await resolveOrganizationContext(createRequest(), res, () => {
    assert.fail("next should not be called");
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "ORGANIZATION_ACCESS_DENIED");
  assert.equal(organizationLookupCalled, false);
});

test("missing Organization returns ORGANIZATION_NOT_FOUND", async (t) => {
  mockUser(t);
  t.mock.method(Organization, "findById", async () => null);

  const res = createResponse();
  await resolveOrganizationContext(createRequest(), res, () => {
    assert.fail("next should not be called");
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, "ORGANIZATION_NOT_FOUND");
});

test("Organization membership and role guards use distinct errors", () => {
  const membershipRes = createResponse();
  requireOrganizationMembership({}, membershipRes, () => {
    assert.fail("next should not be called");
  });
  assert.equal(membershipRes.body.code, "ORGANIZATION_ACCESS_DENIED");

  const roleRes = createResponse();
  requireOrganizationRole("owner")(
    {
      organizationMembership: {
        role: "manager",
        status: "active",
      },
    },
    roleRes,
    () => assert.fail("next should not be called")
  );
  assert.equal(roleRes.body.code, "ORGANIZATION_ROLE_REQUIRED");
});
