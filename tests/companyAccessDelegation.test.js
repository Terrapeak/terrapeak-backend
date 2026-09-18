import assert from "node:assert/strict";
import test from "node:test";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import App from "../models/app.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import ReservationStaffRequest from "../models/reservationStaffRequest.js";
import ChatbotSettings from "../models/chatbotSettings.js";
import User from "../models/user.js";
import requireCompanyWriteAccess from "../middleware/requireCompanyWriteAccess.js";
import resolveCompanyAccess from "../services/companyAccessService.js";
import resolveCompanyContext from "../middleware/resolveCompanyContext.js";

const USER_ID = "64b000000000000000000001";
const ORGANIZATION_ID = "64b000000000000000000002";
const OTHER_ORGANIZATION_ID = "64b000000000000000000003";
const COMPANY_ID = "64b000000000000000000004";

const user = (overrides = {}) => ({
  _id: USER_ID,
  accountStatus: "active",
  isApproved: true,
  invitationStatus: "accepted",
  ...overrides,
});

const company = (overrides = {}) => ({
  _id: COMPANY_ID,
  organizationId: ORGANIZATION_ID,
  isActive: true,
  isPlatformWorkspace: false,
  ...overrides,
});

const organization = (overrides = {}) => ({
  _id: ORGANIZATION_ID,
  organizationType: "distributor",
  status: "active",
  isActive: true,
  ...overrides,
});

const organizationMembership = (overrides = {}) => ({
  _id: "64b000000000000000000005",
  organizationId: ORGANIZATION_ID,
  userId: USER_ID,
  role: "owner",
  status: "active",
  isActive: true,
  ...overrides,
});

const queryWithPopulate = (value) => ({
  populate: async () => value,
});

const mockDirectMemberships = (t, memberships) => {
  t.mock.method(CompanyMembership, "find", () =>
    queryWithPopulate(memberships),
  );
};

const mockDelegatedLookup = (
  t,
  {
    directMemberships = [],
    selectedCompany = company(),
    selectedOrganization = organization(),
    selectedOrganizationMembership = organizationMembership(),
    membership = null,
  } = {},
) => {
  mockDirectMemberships(t, directMemberships);
  const sameId = (left, right) => String(left) === String(right);
  t.mock.method(Company, "findOne", async (filter) =>
    selectedCompany &&
    selectedCompany.isActive === true &&
    selectedCompany.isPlatformWorkspace !== true &&
    (filter.isActive === true || filter.isActive?.$ne === false) &&
    (filter.lifecycleStatus?.$ne === "archived" || !filter.lifecycleStatus) &&
    filter.isPlatformWorkspace?.$ne === true
      ? selectedCompany
      : null,
  );
  t.mock.method(Organization, "findOne", async (filter) =>
    selectedOrganization &&
    selectedOrganization.status === "active" &&
    selectedOrganization.isActive === true &&
    selectedOrganization.organizationType === "distributor" &&
    filter.status === "active" &&
    filter.isActive === true &&
    filter.organizationType === "distributor" &&
    sameId(filter._id, selectedOrganization._id)
      ? selectedOrganization
      : null,
  );
  t.mock.method(
    OrganizationMembership,
    "findOne",
    async (filter) => {
      const result = membership || selectedOrganizationMembership;
      return result &&
        result.status === "active" &&
        result.isActive === true &&
        ["owner", "admin"].includes(result.role) &&
        filter.status === "active" &&
        filter.role?.$in?.includes(result.role) &&
        sameId(filter.organizationId, result.organizationId) &&
        sameId(filter.userId, result.userId)
        ? result
        : null;
    },
  );
};

for (const role of ["owner", "admin", "manager", "staff", "viewer"]) {
  test(`direct Company ${role} retains its existing access source and role`, async (t) => {
    const membership = { companyId: company(), role, status: "active" };
    mockDirectMemberships(t, [membership]);

    const access = await resolveCompanyAccess({
      userId: USER_ID,
      companyId: COMPANY_ID,
      user: user(),
    });

    assert.equal(access.allowed, true);
    assert.equal(access.accessSource, "direct_company_membership");
    assert.equal(access.companyRole, role);
    assert.equal(access.companyMembership, membership);
  });
}

test("duplicate active direct memberships still require explicit safe resolution", async (t) => {
  mockDirectMemberships(t, [
    { companyId: company(), role: "owner", status: "active" },
    { companyId: company(), role: "owner", status: "active" },
  ]);

  const access = await resolveCompanyAccess({
    userId: USER_ID,
    companyId: COMPANY_ID,
    user: user(),
  });

  assert.equal(access.allowed, false);
  assert.equal(access.reason, "multiple_companies");
});

for (const role of ["owner", "admin"]) {
  test(`Distributor Organization ${role} receives delegated Company access`, async (t) => {
    mockDelegatedLookup(t, {
      selectedOrganizationMembership: organizationMembership({ role }),
    });

    const access = await resolveCompanyAccess({
      userId: USER_ID,
      companyId: COMPANY_ID,
      user: user(),
    });

    assert.deepEqual(
      {
        allowed: access.allowed,
        accessSource: access.accessSource,
        companyRole: access.companyRole,
        organizationRole: access.organizationRole,
        company: access.company,
      },
      {
        allowed: true,
        accessSource: "distributor_delegated_access",
        companyRole: null,
        organizationRole: role,
        company: company(),
      },
    );
  });
}

for (const scenario of [
  {
    label: "Distributor Organization member",
    membership: organizationMembership({ role: "member" }),
  },
  {
    label: "Distributor Organization viewer",
    membership: organizationMembership({ role: "viewer" }),
  },
  {
    label: "inactive Organization membership",
    membership: organizationMembership({ status: "inactive" }),
  },
  {
    label: "Organization membership with inactive flag",
    membership: organizationMembership({ isActive: false }),
  },
  {
    label: "suspended user",
    user: user({ accountStatus: "suspended" }),
  },
  {
    label: "unapproved user",
    user: user({ isApproved: false }),
  },
  {
    label: "pending invitation user",
    user: user({ invitationStatus: "pending" }),
  },
  {
    label: "inactive Company",
    selectedCompany: company({ isActive: false }),
  },
  {
    label: "inactive Organization",
    selectedOrganization: organization({ status: "inactive", isActive: false }),
  },
  {
    label: "direct customer Organization",
    selectedOrganization: organization({ organizationType: "direct_customer" }),
  },
  {
    label: "enterprise group Organization",
    selectedOrganization: organization({ organizationType: "enterprise_group" }),
  },
  {
    label: "Company belonging to another Distributor",
    selectedCompany: company({ organizationId: OTHER_ORGANIZATION_ID }),
    selectedOrganization: organization({ _id: OTHER_ORGANIZATION_ID }),
    membership: organizationMembership(),
  },
]) {
  test(`${scenario.label} cannot receive delegated Company access`, async (t) => {
    mockDelegatedLookup(t, {
      ...scenario,
      selectedOrganizationMembership: scenario.membership,
    });

    const access = await resolveCompanyAccess({
      userId: USER_ID,
      companyId: COMPANY_ID,
      user: scenario.user || user(),
    });

    assert.equal(access, null);
  });
}

test("delegated access never creates or fabricates a CompanyMembership", async (t) => {
  let createCalled = false;
  mockDelegatedLookup(t);
  t.mock.method(CompanyMembership, "create", async () => {
    createCalled = true;
  });

  const access = await resolveCompanyAccess({
    userId: USER_ID,
    companyId: COMPANY_ID,
    user: user(),
  });

  assert.equal(access.companyMembership, null);
  assert.equal(createCalled, false);
});

test("central Company context attaches delegated access without a Company role", async (t) => {
  mockDelegatedLookup(t);
  const req = {
    userId: USER_ID,
    user: user(),
    get: (name) => (name === "x-company-id" ? COMPANY_ID : undefined),
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  let nextCalled = false;
  await resolveCompanyContext(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.company._id, COMPANY_ID);
  assert.equal(req.companyMembership, null);
  assert.equal(req.companyAccess.accessSource, "distributor_delegated_access");
  assert.equal(req.companyAccess.companyRole, null);
});

test("delegated access permits operational Company writes through the shared write guard", (t) => {
  const req = {
    companyAccess: { accessSource: "distributor_delegated_access" },
    companyMembership: null,
    route: { path: "/reservations/callback-requests/:requestId" },
  };
  let nextCalled = false;
  requireCompanyWriteAccess(req, {}, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test("delegated Company access cannot use settings or owner-only write routes", (t) => {
  const req = {
    companyAccess: { accessSource: "distributor_delegated_access" },
    companyMembership: null,
    route: { path: "/settings" },
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  let nextCalled = false;
  requireCompanyWriteAccess(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("ordinary Distributor members remain forbidden by central Company context", async (t) => {
  mockDelegatedLookup(t, {
    selectedOrganizationMembership: organizationMembership({ role: "member" }),
  });
  const req = {
    userId: USER_ID,
    user: user(),
    get: (name) => (name === "x-company-id" ? COMPANY_ID : undefined),
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  await resolveCompanyContext(req, res, () => {
    assert.fail("ordinary Distributor members must not receive Company access");
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "COMPANY_ACCESS_DENIED");
});

const routeResponse = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const invokeRoute = async (router, path, req, res) => {
  const layer = router.stack.find(
    (entry) => entry.route?.path === path && entry.route.methods[req.method.toLowerCase()],
  );
  assert.ok(layer, `route ${req.method} ${path} was not registered`);

  const handlers = layer.route.stack.map((entry) => entry.handle);
  let index = 0;
  const next = async (error) => {
    if (error) throw error;
    const handler = handlers[index++];
    if (!handler) return;
    await handler(req, res, next);
  };
  await next();
};

const setupEndpointMocks = (t, accessCase) => {
  process.env.SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  t.mock.method(User, "findById", async () => user());
  t.mock.method(CompanyMembership, "find", () =>
    queryWithPopulate(
      (accessCase.directMemberships || []).filter(
        (membership) =>
          membership.companyId &&
          membership.companyId.isActive !== false &&
          membership.companyId.lifecycleStatus !== "archived",
      ),
    ),
  );
  t.mock.method(Company, "findOne", async (filter) => {
    const selectedCompany = accessCase.selectedCompany;
    if (!selectedCompany) return null;
    if (
      (filter.isActive?.$ne === false && selectedCompany.isActive === false) ||
      (filter.lifecycleStatus?.$ne === "archived" &&
        selectedCompany.lifecycleStatus === "archived")
    ) {
      return null;
    }
    return selectedCompany;
  });
  t.mock.method(Organization, "findOne", async () => accessCase.selectedOrganization || null);
  t.mock.method(OrganizationMembership, "findOne", async (filter) => {
    const membership = accessCase.selectedOrganizationMembership;
    return membership &&
      filter.role?.$in?.includes(membership.role) &&
      membership.status === "active" &&
      membership.isActive === true
      ? membership
      : null;
  });
  t.mock.method(App, "find", () => ({ sort: async () => [] }));
  t.mock.method(CompanyAppInstallation, "find", async () => []);
  t.mock.method(ReservationStaffRequest, "countDocuments", async () => 0);
  t.mock.method(ChatbotSettings, "findOne", async () => ({ _id: "settings-1", companyId: COMPANY_ID }));
};

const endpointRequest = (method = "GET") => ({
  method,
  userId: USER_ID,
  query: { summary: "1" },
  params: {},
  body: {},
  get: (name) => (name === "x-company-id" ? COMPANY_ID : undefined),
});

for (const role of ["owner", "admin"]) {
  test(`real Company apps endpoint permits delegated Distributor ${role}`, async (t) => {
    const accessCase = {
      selectedCompany: company({ reservationBusinessId: 7, reservationBusinessSlug: "customer-4" }),
      selectedOrganization: organization(),
      selectedOrganizationMembership: organizationMembership({ role }),
      directMemberships: [],
    };
    setupEndpointMocks(t, accessCase);
    let membershipCreated = false;
    t.mock.method(CompanyMembership, "create", async () => {
      membershipCreated = true;
    });
    const { default: router } = await import("../routes/company.js");
    const res = routeResponse();
    await invokeRoute(router, "/apps", endpointRequest(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(membershipCreated, false);
  });
}

test("real Company apps endpoint preserves direct customer access", async (t) => {
  const membership = { companyId: company(), role: "owner", status: "active" };
  setupEndpointMocks(t, {
    selectedCompany: company({ reservationBusinessId: 7, reservationBusinessSlug: "customer-4" }),
    directMemberships: [membership],
    selectedOrganization: null,
    selectedOrganizationMembership: null,
  });
  const { default: router } = await import("../routes/company.js");
  const res = routeResponse();
  await invokeRoute(router, "/apps", endpointRequest(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
});

test("real Company apps endpoint denies archived delegated Companies", async (t) => {
  setupEndpointMocks(t, {
    selectedCompany: company({ lifecycleStatus: "archived", isActive: false }),
    selectedOrganization: organization(),
    selectedOrganizationMembership: organizationMembership({ role: "owner" }),
    directMemberships: [],
  });
  const { default: router } = await import("../routes/company.js");
  const res = routeResponse();
  await invokeRoute(router, "/apps", endpointRequest(), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "COMPANY_ACCESS_DENIED");
});

test("real Company apps endpoint denies archived direct Companies", async (t) => {
  setupEndpointMocks(t, {
    selectedCompany: company({ lifecycleStatus: "archived", isActive: false }),
    selectedOrganization: null,
    selectedOrganizationMembership: null,
    directMemberships: [
      { companyId: company({ lifecycleStatus: "archived", isActive: false }), role: "owner", status: "active" },
    ],
  });
  const { default: router } = await import("../routes/company.js");
  const res = routeResponse();
  await invokeRoute(router, "/apps", endpointRequest(), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "COMPANY_ACCESS_DENIED");
});

test("Reservations session bootstrap denies archived delegated Companies", async (t) => {
  setupEndpointMocks(t, {
    selectedCompany: company({ lifecycleStatus: "archived", isActive: false }),
    selectedOrganization: organization(),
    selectedOrganizationMembership: organizationMembership({ role: "owner" }),
    directMemberships: [],
  });
  const { default: router } = await import("../routes/company.js");
  const res = routeResponse();
  await invokeRoute(router, "/apps/reservations/session", endpointRequest("POST"), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "COMPANY_ACCESS_DENIED");
});

test("AI Assistant Company settings deny archived delegated Companies", async (t) => {
  setupEndpointMocks(t, {
    selectedCompany: company({ lifecycleStatus: "archived", isActive: false }),
    selectedOrganization: organization(),
    selectedOrganizationMembership: organizationMembership({ role: "owner" }),
    directMemberships: [],
  });
  const { default: router } = await import("../routes/chatbot.js");
  const res = routeResponse();
  await invokeRoute(router, "/settings", endpointRequest(), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "COMPANY_ACCESS_DENIED");
});

for (const deniedRole of ["member", "viewer"]) {
  test(`real Company apps endpoint denies delegated Distributor ${deniedRole}`, async (t) => {
    setupEndpointMocks(t, {
      selectedCompany: company(),
      selectedOrganization: organization(),
      selectedOrganizationMembership: organizationMembership({ role: deniedRole }),
      directMemberships: [],
    });
    const { default: router } = await import("../routes/company.js");
    const res = routeResponse();
    await invokeRoute(router, "/apps", endpointRequest(), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "COMPANY_ACCESS_DENIED");
  });
}

for (const endpoint of [
  { name: "Reservations callback summary", router: "../routes/company.js", path: "/reservations/callback-requests" },
  { name: "AI Assistant settings", router: "../routes/chatbot.js", path: "/settings" },
]) {
  for (const role of ["owner", "admin"]) {
    test(`real ${endpoint.name} endpoint permits delegated Distributor ${role}`, async (t) => {
      setupEndpointMocks(t, {
        selectedCompany: company(),
        selectedOrganization: organization(),
        selectedOrganizationMembership: organizationMembership({ role }),
        directMemberships: [],
      });
      const { default: router } = await import(endpoint.router);
      const req = endpoint.name.startsWith("Reservations")
        ? endpointRequest()
        : { ...endpointRequest(), query: {} };
      const res = routeResponse();
      await invokeRoute(router, endpoint.path, req, res);
      assert.equal(res.statusCode, 200);
    });
  }

  for (const label of ["member", "unrelated user"]) {
    test(`real ${endpoint.name} endpoint denies delegated ${label}`, async (t) => {
      setupEndpointMocks(t, {
        selectedCompany: company(),
        selectedOrganization: organization(),
        selectedOrganizationMembership: label === "member" ? organizationMembership({ role: "member" }) : null,
        directMemberships: [],
      });
      const { default: router } = await import(endpoint.router);
      const req = endpoint.name.startsWith("Reservations")
        ? endpointRequest()
        : { ...endpointRequest(), query: {} };
      const res = routeResponse();
      await invokeRoute(router, endpoint.path, req, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.code, "COMPANY_ACCESS_DENIED");
    });
  }

  test(`real ${endpoint.name} endpoint preserves direct customer access`, async (t) => {
    setupEndpointMocks(t, {
      selectedCompany: company(),
      selectedOrganization: null,
      selectedOrganizationMembership: null,
      directMemberships: [{ companyId: company(), role: "owner", status: "active" }],
    });
    const { default: router } = await import(endpoint.router);
    const req = endpoint.name.startsWith("Reservations")
      ? endpointRequest()
      : { ...endpointRequest(), query: {} };
    const res = routeResponse();
    await invokeRoute(router, endpoint.path, req, res);
    assert.equal(res.statusCode, 200);
  });
}
