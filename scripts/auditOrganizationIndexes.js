import dotenv from "dotenv";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

import Company from "../models/company.js";
import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";

dotenv.config();

export const REQUIRED_ORGANIZATION_INDEXES = Object.freeze({
  Organization: [
    { key: { slug: 1 }, unique: true },
    { key: { status: 1 }, unique: false },
  ],
  OrganizationMembership: [
    { key: { organizationId: 1, userId: 1 }, unique: true },
    { key: { organizationId: 1, status: 1 }, unique: false },
    { key: { userId: 1, status: 1 }, unique: false },
  ],
  Company: [
    { key: { organizationId: 1 }, unique: false },
  ],
});

const sameKey = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);

export const auditModelIndexes = ({
  modelName,
  actualIndexes,
  requiredIndexes,
}) => {
  const missing = [];
  const conflicting = [];
  const matchedNames = new Set(["_id_"]);

  for (const required of requiredIndexes) {
    const matchingKey = actualIndexes.find((index) =>
      sameKey(index.key, required.key)
    );

    if (!matchingKey) {
      missing.push(required);
      continue;
    }

    matchedNames.add(matchingKey.name);
    if (Boolean(matchingKey.unique) !== required.unique) {
      conflicting.push({
        required,
        actual: {
          name: matchingKey.name,
          key: matchingKey.key,
          unique: Boolean(matchingKey.unique),
        },
      });
    }
  }

  const criticalFields = new Set(
    requiredIndexes.flatMap((index) => Object.keys(index.key))
  );
  const unexpectedCritical = actualIndexes
    .filter((index) => !matchedNames.has(index.name))
    .filter((index) =>
      Object.keys(index.key).some((field) => criticalFields.has(field))
    )
    .map((index) => ({
      name: index.name,
      key: index.key,
      unique: Boolean(index.unique),
    }));

  return {
    model: modelName,
    ok:
      missing.length === 0 &&
      conflicting.length === 0 &&
      unexpectedCritical.length === 0,
    missing,
    conflicting,
    unexpectedCritical,
  };
};

export const auditOrganizationIndexes = async ({
  models = { Organization, OrganizationMembership, Company },
} = {}) => {
  const results = [];

  for (const [modelName, requiredIndexes] of Object.entries(
    REQUIRED_ORGANIZATION_INDEXES
  )) {
    const actualIndexes =
      await models[modelName].collection.indexes();
    results.push(
      auditModelIndexes({
        modelName,
        actualIndexes,
        requiredIndexes,
      })
    );
  }

  return {
    ok: results.every((result) => result.ok),
    models: results,
  };
};

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const report = await auditOrganizationIndexes();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (invokedPath === import.meta.url) {
  run().catch((error) => {
    console.error(
      JSON.stringify(
        {
          success: false,
          code: "ORGANIZATION_INDEX_AUDIT_FAILED",
          message: error.message,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  });
}
