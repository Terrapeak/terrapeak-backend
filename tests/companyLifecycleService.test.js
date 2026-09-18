import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

import Company from "../models/company.js";
import CompanyLifecycleAudit from "../models/companyLifecycleAudit.js";
import CompanyMembership from "../models/companyMembership.js";
import Organization from "../models/organization.js";
import { getMyCompanies } from "../controllers/companyController.js";
import { archiveCompany, restoreCompany } from "../services/companyLifecycleService.js";
import { isCompanyArchived, isCompanyOperational } from "../utils/companyLifecycle.js";

const COMPANY_ID = "64b000000000000000000001";
const ORGANIZATION_ID = "64b000000000000000000002";
const OTHER_ORGANIZATION_ID = "64b000000000000000000003";
const ACTOR_ID = "64b000000000000000000004";

const distributor = (overrides = {}) => ({
  _id: ORGANIZATION_ID,
  organizationType: "distributor",
  status: "active",
  isActive: true,
  ...overrides,
});

const membership = (overrides = {}) => ({
  userId: ACTOR_ID,
  role: "owner",
  status: "active",
  ...overrides,
});

const company = (overrides = {}) => {
  const document = {
    _id: COMPANY_ID,
    name: "Customer One",
    organizationId: ORGANIZATION_ID,
    ownerUserId: "64b000000000000000000005",
    billingSource: "company",
    billing: { status: "active", paymentStatus: "paid" },
    reservationBusinessId: 42,
    reservationBusinessSlug: "customer-one",
    reservationTemplate: "general",
    installedApps: ["ai-assistant", "reservations"],
    isActive: true,
    lifecycleStatus: "active",
    isPlatformWorkspace: false,
    archivedAt: null,
    archivedByUserId: null,
    archiveReason: "",
    save: async function save() {
      return this;
    },
    ...overrides,
  };
  return document;
};

const mockCompany = (t, value) => {
  t.mock.method(Company, "findById", async () => value);
};

const mockAudit = (t, events = []) => {
  t.mock.method(CompanyLifecycleAudit, "create", async (input) => {
    events.push(Array.isArray(input) ? input[0] : input);
    return input;
  });
};

test("legacy and explicit Company lifecycle predicates are safe", () => {
  assert.equal(isCompanyOperational({ isActive: true }), true);
  assert.equal(isCompanyOperational({}), true);
  assert.equal(isCompanyOperational({ isActive: false }), false);
  assert.equal(isCompanyOperational({ isActive: true, lifecycleStatus: "archived" }), false);
  assert.equal(isCompanyArchived({ isActive: false }), true);
});

test("ordinary Company listing excludes inactive and archived Companies while preserving active legacy records", async (t) => {
  let capturedFilter = null;
  let capturedPopulate = null;
  let response = null;
  t.mock.method(CompanyMembership, "find", (filter) => {
    capturedFilter = filter;
    return {
      populate: async (options) => {
        capturedPopulate = options;
        return [
        {
          companyId: { _id: "active", name: "Active", displayName: "Active", slug: "active", isActive: true },
          role: "owner",
        },
        {
          companyId: { _id: "legacy", name: "Legacy", displayName: "Legacy", slug: "legacy" },
          role: "member",
        },
        ];
      },
    };
  });

  await getMyCompanies(
    { userId: ACTOR_ID },
    { json: (payload) => { response = payload; } },
  );

  assert.deepEqual(capturedFilter, { userId: ACTOR_ID, status: "active" });
  assert.deepEqual(capturedPopulate.match, {
    isActive: { $ne: false },
    lifecycleStatus: { $ne: "archived" },
    isPlatformWorkspace: { $ne: true },
  });
  assert.deepEqual(
    response.companies.map((item) => item.companyId),
    ["active", "legacy"],
  );
});

test("Distributor owner archives a Company without changing memberships, billing, or Reservations mapping", async (t) => {
  const target = company();
  const auditEvents = [];
  mockCompany(t, target);
  mockAudit(t, auditEvents);

  const result = await archiveCompany({
    companyId: COMPANY_ID,
    organization: distributor(),
    actorMembership: membership(),
    reason: "Customer requested a temporary pause",
    transactionSupported: false,
  });

  assert.equal(result.alreadyArchived, false);
  assert.equal(target.lifecycleStatus, "archived");
  assert.equal(target.isActive, false);
  assert.equal(target.archiveReason, "Customer requested a temporary pause");
  assert.equal(target.organizationId, ORGANIZATION_ID);
  assert.equal(target.billingSource, "company");
  assert.deepEqual(target.billing, { status: "active", paymentStatus: "paid" });
  assert.equal(target.reservationBusinessId, 42);
  assert.equal(target.reservationBusinessSlug, "customer-one");
  assert.equal(target.reservationTemplate, "general");
  assert.deepEqual(target.installedApps, ["ai-assistant", "reservations"]);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].eventType, "company_archived");
  assert.equal(auditEvents[0].reason, "Customer requested a temporary pause");
});

test("archive authorization is limited to platform admins and the owning Distributor admins", async (t) => {
  const target = company();
  mockCompany(t, target);
  mockAudit(t);

  await assert.rejects(
    () => archiveCompany({
      companyId: COMPANY_ID,
      organization: distributor(),
      actorMembership: membership({ role: "member" }),
      reason: "blocked",
      transactionSupported: false,
    }),
    (error) => error.code === "COMPANY_LIFECYCLE_ACCESS_DENIED",
  );

  await assert.rejects(
    () => archiveCompany({
      companyId: COMPANY_ID,
      organization: distributor({ _id: OTHER_ORGANIZATION_ID }),
      actorMembership: membership(),
      reason: "blocked",
      transactionSupported: false,
    }),
    (error) => error.code === "COMPANY_LIFECYCLE_ACCESS_DENIED",
  );

  target.lifecycleStatus = "active";
  target.isActive = true;
  await archiveCompany({
    companyId: COMPANY_ID,
    actor: { _id: ACTOR_ID, platformRole: "platform-admin" },
    reason: "Platform maintenance",
    transactionSupported: false,
  });
  assert.equal(target.lifecycleStatus, "archived");
});

test("restore validates inherited Organization billing and preserves lifecycle mappings", async (t) => {
  const target = company({
    lifecycleStatus: "archived",
    isActive: false,
    archivedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedByUserId: ACTOR_ID,
    archiveReason: "Paused",
    billingSource: "organization",
  });
  const auditEvents = [];
  const organization = {
    ...distributor(),
    billingMode: "organization",
    plan: "enterprise",
    billing: { status: "active", paymentStatus: "paid" },
    lean: async () => organization,
  };
  mockCompany(t, target);
  mockAudit(t, auditEvents);
  t.mock.method(Organization, "findById", () => organization);

  const result = await restoreCompany({
    companyId: COMPANY_ID,
    organization: distributor(),
    actorMembership: membership({ role: "admin" }),
    reason: "Billing is active again",
    transactionSupported: false,
  });

  assert.equal(result.alreadyActive, false);
  assert.equal(target.lifecycleStatus, "active");
  assert.equal(target.isActive, true);
  assert.equal(target.archivedAt, null);
  assert.equal(target.archivedByUserId, null);
  assert.equal(target.archiveReason, "");
  assert.equal(target.billingSource, "organization");
  assert.equal(target.reservationBusinessId, 42);
  assert.equal(target.reservationBusinessSlug, "customer-one");
  assert.equal(target.reservationTemplate, "general");
  assert.equal(auditEvents[0].eventType, "company_restored");
  assert.equal(auditEvents.length, 1);
});

test("idempotent lifecycle requests do not create duplicate audit events", async (t) => {
  const target = company({ lifecycleStatus: "archived", isActive: false });
  const auditEvents = [];
  mockCompany(t, target);
  mockAudit(t, auditEvents);

  const result = await archiveCompany({
    companyId: COMPANY_ID,
    organization: distributor(),
    actorMembership: membership(),
    reason: "Already archived",
    transactionSupported: false,
  });

  assert.equal(result.alreadyArchived, true);
  assert.equal(auditEvents.length, 0);

  target.lifecycleStatus = "active";
  target.isActive = true;
  const restoreResult = await restoreCompany({
    companyId: COMPANY_ID,
    organization: distributor(),
    actorMembership: membership(),
    transactionSupported: false,
  });
  assert.equal(restoreResult.alreadyActive, true);
  assert.equal(auditEvents.length, 0);
});

test("transaction fallback aborts without an audit when Company persistence fails", async (t) => {
  const target = company();
  const auditEvents = [];
  target.save = async () => {
    throw new Error("company save failed");
  };
  mockCompany(t, target);
  mockAudit(t, auditEvents);

  await assert.rejects(
    () => archiveCompany({
      companyId: COMPANY_ID,
      organization: distributor(),
      actorMembership: membership(),
      reason: "Persistence failure",
      transactionSupported: false,
    }),
    /company save failed/,
  );
  assert.equal(auditEvents.length, 0);
});

test("fallback restores the exact prior lifecycle state when audit persistence fails", async (t) => {
  const archivedAt = new Date("2026-02-01T00:00:00.000Z");
  const target = company({
    lifecycleStatus: "active",
    isActive: true,
    archivedAt,
    archivedByUserId: ACTOR_ID,
    archiveReason: "Existing metadata",
  });
  let saveCount = 0;
  target.save = async () => {
    saveCount += 1;
    return target;
  };
  mockCompany(t, target);
  t.mock.method(CompanyLifecycleAudit, "create", async () => {
    throw new Error("audit save failed");
  });

  await assert.rejects(
    () => archiveCompany({
      companyId: COMPANY_ID,
      organization: distributor(),
      actorMembership: membership(),
      reason: "Archive request",
      transactionSupported: false,
    }),
    (error) => error.code === "COMPANY_LIFECYCLE_AUDIT_FAILED",
  );
  assert.equal(saveCount, 2);
  assert.equal(target.lifecycleStatus, "active");
  assert.equal(target.isActive, true);
  assert.equal(target.archivedAt, archivedAt);
  assert.equal(target.archivedByUserId, ACTOR_ID);
  assert.equal(target.archiveReason, "Existing metadata");
});

test("fallback surfaces a dedicated consistency failure when compensation also fails", async (t) => {
  const target = company();
  let saveCount = 0;
  target.save = async () => {
    saveCount += 1;
    if (saveCount === 2) throw new Error("compensation save failed");
    return target;
  };
  mockCompany(t, target);
  t.mock.method(CompanyLifecycleAudit, "create", async () => {
    throw new Error("audit save failed");
  });

  await assert.rejects(
    () => archiveCompany({
      companyId: COMPANY_ID,
      organization: distributor(),
      actorMembership: membership(),
      reason: "Archive request",
      transactionSupported: false,
    }),
    (error) =>
      error.code === "COMPANY_LIFECYCLE_CONSISTENCY_FAILURE" &&
      error.details?.auditPersistenceFailed === true &&
      error.details?.compensationFailed === true &&
      error.details?.lifecycleMutationMayHavePartiallyApplied === true,
  );
});

test("transaction aborts and leaves no audit when audit creation fails", async (t) => {
  const target = company();
  const session = {
    withTransaction: async (callback) => {
      try {
        await callback();
      } catch (error) {
        session.aborted = true;
        throw error;
      }
    },
    endSession: async () => {
      session.ended = true;
    },
  };
  target.save = async (options) => {
    assert.equal(options.session, session);
    return target;
  };
  mockCompany(t, target);
  t.mock.method(mongoose, "startSession", async () => session);
  t.mock.method(CompanyLifecycleAudit, "create", async () => {
    throw new Error("transaction audit failed");
  });

  await assert.rejects(
    () => archiveCompany({
      companyId: COMPANY_ID,
      organization: distributor(),
      actorMembership: membership(),
      reason: "Transaction failure",
      transactionSupported: true,
    }),
    /transaction audit failed/,
  );
  assert.equal(session.aborted, true);
  assert.equal(session.ended, true);
});

test("transaction aborts and leaves no audit when Company persistence fails", async (t) => {
  const target = company();
  const session = {
    withTransaction: async (callback) => {
      try {
        await callback();
      } catch (error) {
        session.aborted = true;
        throw error;
      }
    },
    endSession: async () => {
      session.ended = true;
    },
  };
  target.save = async (options) => {
    assert.equal(options.session, session);
    throw new Error("transaction Company save failed");
  };
  mockCompany(t, target);
  let auditCalled = false;
  t.mock.method(CompanyLifecycleAudit, "create", async () => {
    auditCalled = true;
  });
  t.mock.method(mongoose, "startSession", async () => session);

  await assert.rejects(
    () => archiveCompany({
      companyId: COMPANY_ID,
      organization: distributor(),
      actorMembership: membership(),
      reason: "Transaction failure",
      transactionSupported: true,
    }),
    /transaction Company save failed/,
  );
  assert.equal(auditCalled, false);
  assert.equal(session.aborted, true);
  assert.equal(session.ended, true);
});

test("restore rejects a Company whose inherited billing Organization is missing", async (t) => {
  const target = company({ lifecycleStatus: "archived", isActive: false, billingSource: "organization" });
  mockCompany(t, target);
  mockAudit(t);
  t.mock.method(Organization, "findById", async () => null);

  await assert.rejects(
    () => restoreCompany({
      companyId: COMPANY_ID,
      actor: { _id: ACTOR_ID, platformRole: "platform-owner" },
      transactionSupported: false,
    }),
    (error) => error.code === "COMPANY_ORGANIZATION_INVALID",
  );
  assert.equal(target.lifecycleStatus, "archived");
  assert.equal(target.isActive, false);
});

test("restore rejects invalid Company billing without changing billing ownership", async (t) => {
  const target = company({
    lifecycleStatus: "archived",
    isActive: false,
    organizationId: null,
    billing: { status: "not_configured" },
  });
  mockCompany(t, target);
  mockAudit(t);

  await assert.rejects(
    () => restoreCompany({
      companyId: COMPANY_ID,
      actor: { _id: ACTOR_ID, platformRole: "platform-admin" },
      transactionSupported: false,
    }),
    (error) => error.code === "COMPANY_BILLING_INVALID",
  );
  assert.equal(target.billingSource, "company");
  assert.equal(target.lifecycleStatus, "archived");
});
