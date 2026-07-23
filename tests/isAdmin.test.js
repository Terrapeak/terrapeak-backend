import assert from "node:assert/strict";
import test from "node:test";

import jwt from "jsonwebtoken";

import isAdmin from "../middleware/isAdmin.js";
import User from "../models/user.js";

const USER_ID = "64b000000000000000000001";

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

const createRequest = () => ({
  cookies: {},
  get: (name) => (name === "authorization" ? "Bearer stale-token" : undefined),
});

const mockToken = (t, claims) => {
  t.mock.method(jwt, "verify", () => ({
    _id: USER_ID,
    authScope: "dashboard",
    ...claims,
  }));
};

const mockUserLookup = (t, user) => {
  t.mock.method(User, "findById", (userId) => {
    assert.equal(userId, USER_ID);
    return {
      select: async () => user,
    };
  });
};

test("stale JWT admin claim is rejected when database isAdmin is false", async (t) => {
  mockToken(t, { isAdmin: true });
  mockUserLookup(t, {
    _id: USER_ID,
    isApproved: true,
    isAdmin: false,
  });

  const req = createRequest();
  const res = createResponse();
  let nextCalled = false;

  await isAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("legacy admin access rejects a deleted user", async (t) => {
  mockToken(t, { isAdmin: true });
  mockUserLookup(t, null);

  const res = createResponse();
  await isAdmin(createRequest(), res, () => {
    assert.fail("next should not be called");
  });

  assert.equal(res.statusCode, 403);
});

test("legacy admin access rejects an unapproved database user", async (t) => {
  mockToken(t, { isAdmin: true });
  mockUserLookup(t, {
    _id: USER_ID,
    isApproved: false,
    isAdmin: true,
  });

  const res = createResponse();
  await isAdmin(createRequest(), res, () => {
    assert.fail("next should not be called");
  });

  assert.equal(res.statusCode, 403);
});

test("database admin state is authoritative over a stale false JWT claim", async (t) => {
  mockToken(t, { isAdmin: false });
  mockUserLookup(t, {
    _id: USER_ID,
    isApproved: true,
    isAdmin: true,
  });

  const req = createRequest();
  const res = createResponse();
  let nextCalled = false;

  await isAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.userId, USER_ID);
  assert.equal(req.authTokenSource, "bearer");
  assert.equal(res.statusCode, 200);
});
