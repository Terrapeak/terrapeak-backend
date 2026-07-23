import assert from "node:assert/strict";
import test from "node:test";

import {
  auditModelIndexes,
  REQUIRED_ORGANIZATION_INDEXES,
} from "../scripts/auditOrganizationIndexes.js";
import { auditOrganizationHardening } from "../scripts/auditOrganizationHardening.js";

const declaredOrganizationIndexes = [
  { name: "_id_", key: { _id: 1 } },
  { name: "slug_1", key: { slug: 1 }, unique: true },
  { name: "status_1", key: { status: 1 } },
];

test("index audit accepts the required critical indexes", () => {
  const result = auditModelIndexes({
    modelName: "Organization",
    actualIndexes: declaredOrganizationIndexes,
    requiredIndexes: REQUIRED_ORGANIZATION_INDEXES.Organization,
  });
  assert.equal(result.ok, true);
});

test("index audit reports a missing required index", () => {
  const result = auditModelIndexes({
    modelName: "Organization",
    actualIndexes: declaredOrganizationIndexes.filter(
      (index) => index.name !== "status_1"
    ),
    requiredIndexes: REQUIRED_ORGANIZATION_INDEXES.Organization,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [{ key: { status: 1 }, unique: false }]);
});

test("index audit reports conflicting uniqueness", () => {
  const result = auditModelIndexes({
    modelName: "Organization",
    actualIndexes: declaredOrganizationIndexes.map((index) =>
      index.name === "slug_1" ? { ...index, unique: false } : index
    ),
    requiredIndexes: REQUIRED_ORGANIZATION_INDEXES.Organization,
  });
  assert.equal(result.ok, false);
  assert.equal(result.conflicting.length, 1);
});

const auditModels = (resultsByCall) => {
  let call = 0;
  const model = {
    collection: { name: "collection" },
    aggregate: async () => [resultsByCall[call++] || {}],
  };
  return {
    User: model,
    Organization: model,
    OrganizationMembership: model,
    Company: model,
  };
};

test("hardening audit exits cleanly when every check is empty", async () => {
  const report = await auditOrganizationHardening({
    models: auditModels([]),
  });
  assert.equal(report.ok, true);
  assert.equal(report.findings.length, 11);
  assert.equal(report.findings.every((finding) => finding.count === 0), true);
});

test("hardening audit reports critical findings with safe IDs", async () => {
  const report = await auditOrganizationHardening({
    models: auditModels([
      {
        count: [{ value: 1 }],
        samples: [
          {
            membershipId: "64b000000000000000000001",
            userId: "64b000000000000000000002",
          },
        ],
      },
    ]),
  });

  assert.equal(report.ok, false);
  assert.equal(report.findings[0].count, 1);
  assert.deepEqual(report.findings[0].samples, [
    {
      membershipId: "64b000000000000000000001",
      userId: "64b000000000000000000002",
    },
  ]);
});
