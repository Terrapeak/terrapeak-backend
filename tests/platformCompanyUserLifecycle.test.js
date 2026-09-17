import assert from "node:assert/strict";
import test from "node:test";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";
import {
  findPlatformUserEmailConflict,
  updatePlatformCompanyUserLifecycle,
} from "../controllers/platformCompanyUserLifecycleController.js";

const COMPANY_ID = "64b000000000000000000001";
const MEMBERSHIP_ID = "64b000000000000000000002";
const USER_ID = "64b000000000000000000003";

const createResponse = () => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      response.statusCode = code;
      return response;
    },
    json(body) {
      response.body = body;
      return response;
    },
  };
  return response;
};

const createRequest = (body) => ({
  params: { companyId: COMPANY_ID, membershipId: MEMBERSHIP_ID },
  body,
  platformUser: { _id: "platform-1", email: "platform@example.com" },
});

const setup = (t, { conflict = null } = {}) => {
  let emailLookup = null;
  const user = {
    _id: USER_ID,
    name: "Customer User",
    email: "old@example.com",
    phone: "+15550000001",
    platformRole: "none",
    save: t.mock.fn(async function save() {
      return this;
    }),
  };
  const membership = {
    _id: MEMBERSHIP_ID,
    companyId: COMPANY_ID,
    userId: USER_ID,
    role: "staff",
    status: "active",
    async save() {
      return this;
    },
  };

  t.mock.method(CompanyMembership, "findOne", async () => membership);
  t.mock.method(User, "findById", async () => user);
  t.mock.method(User, "findOne", (filter) => {
    emailLookup = filter;
    return {
      select: () => conflict,
    };
  });
  t.mock.method(Company, "findById", () => ({
    select: async () => null,
  }));
  t.mock.method(Company, "updateOne", async () => ({ acknowledged: true }));

  return { user, membership, emailLookup: () => emailLookup };
};

test("platform Company user email edits persist normalized Mongo User email", { concurrency: false }, async (t) => {
  const { user } = setup(t);
  const response = createResponse();

  await updatePlatformCompanyUserLifecycle(
    createRequest({ email: "  NEW@Example.COM  " }),
    response,
    () => {},
  );

  assert.equal(response.statusCode, 200);
  assert.equal(user.email, "new@example.com");
  assert.equal(user.save.mock.calls.length, 1);
  assert.equal(response.body.user.email, "new@example.com");
});

test("platform Company user email edits reject duplicate addresses", { concurrency: false }, async (t) => {
  const { emailLookup } = setup(t, { conflict: { _id: "other-user" } });
  const response = createResponse();

  await updatePlatformCompanyUserLifecycle(
    createRequest({ email: "taken@example.com" }),
    response,
    () => {},
  );

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.message, "Email address is already in use.");
  assert.deepEqual(emailLookup(), {
    email: "taken@example.com",
    _id: { $ne: USER_ID },
  });
});

test("platform email conflict lookup excludes the current User and finds another User", async (t) => {
  const { emailLookup } = setup(t, { conflict: { _id: "other-user" } });
  const conflict = await findPlatformUserEmailConflict({
    email: "taken@example.com",
    userId: USER_ID,
  });
  assert.deepEqual(conflict, { _id: "other-user" });
  assert.deepEqual(emailLookup(), {
    email: "taken@example.com",
    _id: { $ne: USER_ID },
  });
});

test("platform Company user email edits reject invalid addresses", { concurrency: false }, async (t) => {
  setup(t);
  const response = createResponse();

  await updatePlatformCompanyUserLifecycle(
    createRequest({ email: "not-an-email" }),
    response,
    () => {},
  );

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, "A valid user email is required.");
});
