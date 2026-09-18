import assert from "node:assert/strict";
import test from "node:test";

import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import OrganizationOwnerAudit from "../models/organizationOwnerAudit.js";
import User from "../models/user.js";
import {
  sendOrganizationOwnerPasswordReset,
  updateOrganizationOwner,
} from "../services/organizationOwnerService.js";

const ORGANIZATION_ID = "64b000000000000000000001";
const USER_ID = "64b000000000000000000002";
const ACTOR_ID = "64b000000000000000000003";
const OTHER_USER_ID = "64b000000000000000000004";

const actor = (platformRole = "platform-admin") => ({
  _id: ACTOR_ID,
  platformRole,
});

const installMocks = (t, {
  ownerOverrides = {},
  membershipOverrides = {},
  existingUser = null,
  auditEvents = [],
  saveFailure = null,
} = {}) => {
  const persisted = {
    _id: USER_ID,
    name: "Original Owner",
    email: "owner@example.com",
    password: "hashed-password",
    phone: "+15551234567",
    passwordChangedAt: null,
    mustChangePassword: false,
    passwordResetTokenHash: "old-reset-hash",
    passwordResetExpiresAt: new Date("2026-09-19T00:00:00.000Z"),
    passwordResetSentAt: new Date("2026-09-18T00:00:00.000Z"),
    ...ownerOverrides,
  };
  const membership = {
    _id: "64b000000000000000000005",
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "owner",
    status: "active",
    ...membershipOverrides,
  };
  const user = {
    ...persisted,
    save: async function save() {
      if (saveFailure) throw saveFailure;
      Object.assign(persisted, {
        name: this.name,
        email: this.email,
        passwordChangedAt: this.passwordChangedAt,
        mustChangePassword: this.mustChangePassword,
        passwordResetTokenHash: this.passwordResetTokenHash,
        passwordResetExpiresAt: this.passwordResetExpiresAt,
        passwordResetSentAt: this.passwordResetSentAt,
      });
      return this;
    },
  };

  t.mock.method(Organization, "findById", async () => ({
    _id: ORGANIZATION_ID,
    name: "Example Organization",
  }));
  t.mock.method(OrganizationMembership, "findOne", async (filter) => {
    if (filter?.status === "active") {
      return membership.status === "active" ? membership : null;
    }
    return membership;
  });
  t.mock.method(User, "findById", async () => user);
  t.mock.method(User, "findOne", (filter) => ({
    select: async () =>
      existingUser && String(filter?._id?.$ne) !== String(existingUser._id)
        ? existingUser
        : null,
  }));
  t.mock.method(OrganizationOwnerAudit, "create", async (input) => {
    const event = Array.isArray(input) ? input[0] : input;
    auditEvents.push(event);
    return input;
  });

  return { persisted, membership, user, auditEvents };
};

test("updates the canonical owner User and rereads normalized identity", async (t) => {
  const state = installMocks(t);
  let resetUser = null;

  await updateOrganizationOwner({
    actor: actor(),
    organizationId: ORGANIZATION_ID,
    updates: { name: "  Updated Owner ", email: "  NEW@Example.COM " },
    transactionSupported: false,
    issueReset: async ({ user }) => {
      resetUser = user;
      user.passwordResetTokenHash = "new-reset-hash";
      user.passwordResetExpiresAt = new Date("2026-09-20T00:00:00.000Z");
      user.passwordResetSentAt = new Date("2026-09-18T01:00:00.000Z");
    },
  });

  assert.equal(resetUser, state.user);
  assert.equal(state.persisted.name, "Updated Owner");
  assert.equal(state.persisted.email, "new@example.com");
  assert.equal(state.persisted._id, USER_ID);
  assert.equal(state.persisted.password, "hashed-password");
  assert.ok(state.persisted.passwordChangedAt instanceof Date);
  assert.equal(state.persisted.mustChangePassword, true);
  assert.equal(state.membership.userId, USER_ID);
  assert.equal(state.membership.role, "owner");
  assert.equal(state.membership.status, "active");
  assert.equal(state.auditEvents.length, 1);
  assert.equal(state.auditEvents[0].eventType, "organization_owner_details_updated");
  assert.equal(state.auditEvents[0].before.email, "ow***@example.com");
  assert.equal(state.auditEvents[0].after.email, "ne*@example.com");
  assert.equal(JSON.stringify(state.auditEvents).includes("new-reset-hash"), false);
});

test("rejects a duplicate normalized owner email before persistence", async (t) => {
  const state = installMocks(t, {
    existingUser: { _id: OTHER_USER_ID, email: "other@example.com" },
  });
  let saveCalls = 0;
  state.user.save = async () => {
    saveCalls += 1;
  };

  await assert.rejects(
    updateOrganizationOwner({
      actor: actor(),
      organizationId: ORGANIZATION_ID,
      updates: { email: " OTHER@EXAMPLE.COM " },
      transactionSupported: false,
      issueReset: async () => assert.fail("reset must not be issued"),
    }),
    (error) => error.code === "OWNER_EMAIL_CONFLICT" && error.statusCode === 409,
  );
  assert.equal(saveCalls, 0);
});

test("requires an active Organization owner and Platform authorization", async (t) => {
  installMocks(t, { membershipOverrides: { status: "inactive" } });
  await assert.rejects(
    updateOrganizationOwner({
      actor: actor(),
      organizationId: ORGANIZATION_ID,
      updates: { name: "No Owner" },
      transactionSupported: false,
    }),
    (error) => error.code === "ORGANIZATION_ACTIVE_OWNER_NOT_FOUND",
  );

  installMocks(t);
  await assert.rejects(
    updateOrganizationOwner({
      actor: { _id: ACTOR_ID, platformRole: "none" },
      organizationId: ORGANIZATION_ID,
      updates: { name: "Denied" },
      transactionSupported: false,
    }),
    (error) => error.code === "PLATFORM_ROLE_REQUIRED" && error.statusCode === 403,
  );
});

test("maps a duplicate-key race to a conflict and restores the User", async (t) => {
  const state = installMocks(t);
  let saveCalls = 0;
  state.user.save = async function save() {
    saveCalls += 1;
    if (saveCalls === 1) {
      const error = new Error("duplicate");
      error.code = 11000;
      error.keyPattern = { email: 1 };
      throw error;
    }
    Object.assign(state.persisted, { name: this.name, email: this.email });
    return this;
  };

  await assert.rejects(
    updateOrganizationOwner({
      actor: actor(),
      organizationId: ORGANIZATION_ID,
      updates: { email: "race@example.com" },
      transactionSupported: false,
    }),
    (error) => error.code === "OWNER_EMAIL_CONFLICT" && error.statusCode === 409,
  );
  assert.equal(saveCalls, 2);
  assert.equal(state.persisted.email, "owner@example.com");
});

test("sends a reset without requiring CompanyMembership and records only safe audit data", async (t) => {
  const state = installMocks(t);
  let resetEmail = null;
  await sendOrganizationOwnerPasswordReset({
    actor: actor("platform-owner"),
    organizationId: ORGANIZATION_ID,
    issueReset: async ({ user }) => {
      resetEmail = user.email;
      user.passwordResetTokenHash = "reset-hash-never-audited";
    },
  });

  assert.equal(resetEmail, "owner@example.com");
  assert.equal(state.auditEvents.length, 1);
  assert.equal(state.auditEvents[0].eventType, "organization_owner_password_reset_sent");
  assert.equal(state.auditEvents[0].after.email, "ow***@example.com");
  assert.equal(JSON.stringify(state.auditEvents).includes("reset-hash-never-audited"), false);
});

test("does not create a success audit when reset delivery fails", async (t) => {
  const state = installMocks(t);
  await assert.rejects(
    sendOrganizationOwnerPasswordReset({
      actor: actor(),
      organizationId: ORGANIZATION_ID,
      issueReset: async () => {
        throw new Error("email delivery failed");
      },
    }),
    /email delivery failed/,
  );
  assert.equal(state.auditEvents.length, 0);
  assert.equal(state.persisted.passwordResetTokenHash, "old-reset-hash");
});

test("restores the User when owner audit persistence fails", async (t) => {
  const state = installMocks(t);
  t.mock.method(OrganizationOwnerAudit, "create", async () => {
    throw new Error("audit unavailable");
  });

  await assert.rejects(
    updateOrganizationOwner({
      actor: actor(),
      organizationId: ORGANIZATION_ID,
      updates: { name: "Temporary Name" },
      transactionSupported: false,
    }),
    /audit unavailable/,
  );
  assert.equal(state.persisted.name, "Original Owner");
  assert.equal(state.persisted.email, "owner@example.com");
});
