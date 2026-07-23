import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { updateUser } from "../controllers/userController.js";
import resolveCompanyContext from "../middleware/resolveCompanyContext.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";

const USER_ID = "64b000000000000000000001";
const COMPANY_ID = "64b000000000000000000002";
const OTHER_COMPANY_ID = "64b000000000000000000003";

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

const createCompany = (id = COMPANY_ID) => ({
  _id: id,
  name: "Customer Company",
  isActive: true,
  isPlatformWorkspace: false,
});

const createMembership = (company = createCompany()) => ({
  _id: "64b000000000000000000004",
  userId: USER_ID,
  companyId: company,
  role: "owner",
  isActive: true,
  status: "active",
});

const mockMemberships = (t, memberships, onFilter = () => {}) => {
  t.mock.method(CompanyMembership, "find", (filter) => {
    onFilter(filter);
    return {
      populate: async () => memberships,
    };
  });
};

test("updateUser only forwards editable profile fields", async (t) => {
  let receivedUpdates = null;

  t.mock.method(User, "findByIdAndUpdate", async (_userId, updates) => {
    receivedUpdates = updates;
    return { _id: USER_ID, ...updates };
  });

  const req = {
    params: { id: USER_ID },
    body: {
      name: "  Safe Name  ",
      email: "  SAFE@EXAMPLE.COM ",
      platformRole: "platform-owner",
      isAdmin: true,
      companyId: OTHER_COMPANY_ID,
      ownerUserId: OTHER_COMPANY_ID,
      organizationId: OTHER_COMPANY_ID,
      billing: { status: "active" },
    },
  };
  const res = createResponse();

  await updateUser(req, res);

  assert.deepEqual(receivedUpdates, {
    name: "Safe Name",
    email: "safe@example.com",
  });
  assert.equal(res.statusCode, 200);
});

test("resolveCompanyContext attaches the only active customer membership", async (t) => {
  const membership = createMembership();
  mockMemberships(t, [membership], (filter) => {
    assert.equal(filter.userId, USER_ID);
    assert.equal(filter.status, "active");
    assert.equal(filter.isActive, undefined);
    assert.equal(filter.companyId, undefined);
  });

  const req = {
    userId: USER_ID,
    get: () => undefined,
  };
  const res = createResponse();
  let nextCalled = false;

  await resolveCompanyContext(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.company, membership.companyId);
  assert.equal(req.companyMembership, membership);
});

test("resolveCompanyContext requires an explicit selection for multiple companies", async (t) => {
  mockMemberships(t, [
    createMembership(createCompany(COMPANY_ID)),
    createMembership(createCompany(OTHER_COMPANY_ID)),
  ]);

  const req = {
    userId: USER_ID,
    get: () => undefined,
  };
  const res = createResponse();

  await resolveCompanyContext(req, res, () => {
    assert.fail("next should not be called");
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "COMPANY_CONTEXT_REQUIRED");
});

test("resolveCompanyContext validates a selected company against membership", async (t) => {
  mockMemberships(t, [], (filter) => {
    assert.equal(filter.companyId, OTHER_COMPANY_ID);
  });

  const req = {
    userId: USER_ID,
    get: (name) => (name === "x-company-id" ? OTHER_COMPANY_ID : undefined),
  };
  const res = createResponse();

  await resolveCompanyContext(req, res, () => {
    assert.fail("next should not be called");
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "COMPANY_ACCESS_DENIED");
});

test("customer tenant ownership and chatbot sessions stay server-scoped", () => {
  const chatbotSource = readFileSync(
    new URL("../controllers/chatbotController.js", import.meta.url),
    "utf8"
  );
  const facebookSource = readFileSync(
    new URL("../controllers/facebookChannelController.js", import.meta.url),
    "utf8"
  );
  const disconnectSource = readFileSync(
    new URL(
      "../controllers/facebookChannelDisconnectController.js",
      import.meta.url
    ),
    "utf8"
  );
  const allowedFields =
    chatbotSource.match(/const ALLOWED_FIELDS = \[([\s\S]*?)\];/)?.[1] || "";

  assert.doesNotMatch(allowedFields, /["']companyId["']/);
  assert.doesNotMatch(allowedFields, /["']reservationBusinessSlug["']/);
  assert.doesNotMatch(facebookSource, /req\.body\??\.companyId/);
  assert.doesNotMatch(disconnectSource, /req\.body\??\.companyId/);
  assert.doesNotMatch(
    chatbotSource,
    /Session\.findOne\(\{\s*sessionId\s*\}\)/
  );
  assert.match(
    chatbotSource,
    /Session\.findOne\(\{\s*sessionId,\s*chatbotId:\s*settings\._id/
  );
});
