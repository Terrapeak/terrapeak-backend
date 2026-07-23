import assert from "node:assert/strict";
import test from "node:test";

import {
  INVALID_STATUS_FILTER,
  MEMBERSHIP_REPAIR_RULES,
  auditCompanyMembershipCollection,
  backfillCompanyMembershipCollection,
  getCanonicalMembershipRepair,
  parseMigrationMode,
} from "../scripts/auditAndBackfillCompanyMemberships.js";

const hasOwn = (value, key) =>
  Object.prototype.hasOwnProperty.call(value, key);

const matchesCondition = (document, field, condition) => {
  const exists = hasOwn(document, field);
  const value = document[field];

  if (
    condition &&
    typeof condition === "object" &&
    !Array.isArray(condition)
  ) {
    return Object.entries(condition).every(([operator, expected]) => {
      if (operator === "$exists") return exists === expected;
      if (operator === "$ne") return !exists || value !== expected;
      if (operator === "$nin") {
        return !exists || !expected.includes(value);
      }
      throw new Error(`Unsupported test operator: ${operator}`);
    });
  }

  if (condition === null) return !exists || value === null;
  return exists && value === condition;
};

const matchesFilter = (document, filter) =>
  Object.entries(filter).every(([field, condition]) => {
    if (field === "$and") {
      return condition.every((child) => matchesFilter(document, child));
    }
    if (field === "$or") {
      return condition.some((child) => matchesFilter(document, child));
    }
    return matchesCondition(document, field, condition);
  });

const reconciliationCases = [
  {
    name: "active true is already canonical",
    document: { status: "active", isActive: true },
    ruleId: null,
    patch: null,
  },
  {
    name: "active false preserves explicit deactivation",
    document: { status: "active", isActive: false },
    ruleId: "active_false_to_inactive",
    patch: { status: "inactive", isActive: false },
  },
  {
    name: "active missing flag derives true",
    document: { status: "active" },
    ruleId: "active_derive_true",
    patch: { status: "active", isActive: true },
  },
  {
    name: "active null flag derives true",
    document: { status: "active", isActive: null },
    ruleId: "active_derive_true",
    patch: { status: "active", isActive: true },
  },
  {
    name: "inactive false is already canonical",
    document: { status: "inactive", isActive: false },
    ruleId: null,
    patch: null,
  },
  {
    name: "inactive true derives false",
    document: { status: "inactive", isActive: true },
    ruleId: "inactive_derive_false",
    patch: { status: "inactive", isActive: false },
  },
  {
    name: "inactive missing flag derives false",
    document: { status: "inactive" },
    ruleId: "inactive_derive_false",
    patch: { status: "inactive", isActive: false },
  },
  {
    name: "removed false is already canonical",
    document: { status: "removed", isActive: false },
    ruleId: null,
    patch: null,
  },
  {
    name: "removed true remains removed and derives false",
    document: { status: "removed", isActive: true },
    ruleId: "removed_derive_false",
    patch: { status: "removed", isActive: false },
  },
  {
    name: "removed missing flag remains removed",
    document: { status: "removed" },
    ruleId: "removed_derive_false",
    patch: { status: "removed", isActive: false },
  },
  {
    name: "missing status with false flag becomes inactive",
    document: { isActive: false },
    ruleId: "missing_status_false_to_inactive",
    patch: { status: "inactive", isActive: false },
  },
  {
    name: "null status with false flag becomes inactive",
    document: { status: null, isActive: false },
    ruleId: "missing_status_false_to_inactive",
    patch: { status: "inactive", isActive: false },
  },
  {
    name: "missing status with true flag becomes active",
    document: { isActive: true },
    ruleId: "missing_status_to_active",
    patch: { status: "active", isActive: true },
  },
  {
    name: "missing status and flag uses schema-compatible active default",
    document: {},
    ruleId: "missing_status_to_active",
    patch: { status: "active", isActive: true },
  },
  {
    name: "null status and flag uses schema-compatible active default",
    document: { status: null, isActive: null },
    ruleId: "missing_status_to_active",
    patch: { status: "active", isActive: true },
  },
];

for (const scenario of reconciliationCases) {
  test(`membership migration: ${scenario.name}`, () => {
    const decision = getCanonicalMembershipRepair(scenario.document);
    assert.deepEqual(decision.patch, scenario.patch);

    const matchingRules = MEMBERSHIP_REPAIR_RULES.filter((rule) =>
      matchesFilter(scenario.document, rule.filter)
    );

    assert.deepEqual(
      matchingRules.map((rule) => rule.id),
      scenario.ruleId ? [scenario.ruleId] : []
    );

    if (scenario.ruleId) {
      assert.equal(decision.classification, scenario.ruleId);
      assert.deepEqual(matchingRules[0].set, scenario.patch);

      const repaired = { ...scenario.document, ...scenario.patch };
      assert.deepEqual(getCanonicalMembershipRepair(repaired), {
        classification: "consistent",
        patch: null,
      });
      assert.equal(
        MEMBERSHIP_REPAIR_RULES.some((rule) =>
          matchesFilter(repaired, rule.filter)
        ),
        false
      );
    }
  });
}

test("invalid status is reported and never assigned an automatic repair", () => {
  const document = { status: "disabled", isActive: false };

  assert.deepEqual(getCanonicalMembershipRepair(document), {
    classification: "invalid_status",
    patch: null,
  });
  assert.equal(matchesFilter(document, INVALID_STATUS_FILTER), true);
  assert.equal(
    MEMBERSHIP_REPAIR_RULES.some((rule) =>
      matchesFilter(document, rule.filter)
    ),
    false
  );
});

test("audit reports disjoint repair counts and consistent remainder", async () => {
  const counts = [20, 2, 1, 2, 3, 4, 5, 1];
  const collection = {
    countDocuments: async () => counts.shift(),
  };

  const audit = await auditCompanyMembershipCollection(collection);

  assert.deepEqual(audit, {
    total: 20,
    consistent: 2,
    invalidStatus: 2,
    repairTotal: 16,
    repairs: {
      active_false_to_inactive: 1,
      active_derive_true: 2,
      inactive_derive_false: 3,
      removed_derive_false: 4,
      missing_status_false_to_inactive: 5,
      missing_status_to_active: 1,
    },
  });
});

test("backfill refuses all writes when invalid statuses exist", async () => {
  let updateCalls = 0;
  const collection = {
    updateMany: async () => {
      updateCalls += 1;
    },
  };

  await assert.rejects(
    () =>
      backfillCompanyMembershipCollection(collection, {
        audit: { invalidStatus: 1 },
      }),
    (error) => error.code === "INVALID_MEMBERSHIP_STATUS"
  );
  assert.equal(updateCalls, 0);
});

test("backfill applies every rule with one shared migration timestamp", async () => {
  const now = new Date("2026-07-23T00:00:00.000Z");
  const calls = [];
  const collection = {
    updateMany: async (filter, update) => {
      calls.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };

  const results = await backfillCompanyMembershipCollection(collection, {
    audit: { invalidStatus: 0 },
    now,
  });

  assert.equal(calls.length, MEMBERSHIP_REPAIR_RULES.length);
  MEMBERSHIP_REPAIR_RULES.forEach((rule, index) => {
    assert.equal(calls[index].filter, rule.filter);
    assert.deepEqual(calls[index].update, {
      $set: { ...rule.set, updatedAt: now },
    });
    assert.deepEqual(results[rule.id], {
      matchedCount: 1,
      modifiedCount: 1,
    });
  });
});

test("migration CLI is audit-only unless --apply is explicit", () => {
  assert.equal(parseMigrationMode([]), "audit");
  assert.equal(parseMigrationMode(["--apply"]), "apply");
  assert.throws(
    () => parseMigrationMode(["--force"]),
    /Unknown argument/
  );
});
