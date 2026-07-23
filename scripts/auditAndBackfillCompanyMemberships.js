import dotenv from "dotenv";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

import CompanyMembership from "../models/companyMembership.js";

dotenv.config();

export const VALID_MEMBERSHIP_STATUSES = Object.freeze([
  "active",
  "inactive",
  "removed",
]);

export const INVALID_STATUS_FILTER = Object.freeze({
  status: {
    $exists: true,
    $nin: [null, ...VALID_MEMBERSHIP_STATUSES],
  },
});

const MISSING_STATUS_FILTER = {
  $or: [{ status: { $exists: false } }, { status: null }],
};

export const MEMBERSHIP_REPAIR_RULES = Object.freeze([
  {
    id: "active_false_to_inactive",
    description:
      "Preserve an explicit legacy deactivation by changing active to inactive.",
    filter: { status: "active", isActive: false },
    set: { status: "inactive", isActive: false },
  },
  {
    id: "active_derive_true",
    description:
      "Derive the compatibility flag for active memberships without a Boolean flag.",
    filter: { status: "active", isActive: { $nin: [true, false] } },
    set: { status: "active", isActive: true },
  },
  {
    id: "inactive_derive_false",
    description: "Derive the compatibility flag for inactive memberships.",
    filter: { status: "inactive", isActive: { $ne: false } },
    set: { status: "inactive", isActive: false },
  },
  {
    id: "removed_derive_false",
    description: "Keep removed memberships inactive.",
    filter: { status: "removed", isActive: { $ne: false } },
    set: { status: "removed", isActive: false },
  },
  {
    id: "missing_status_false_to_inactive",
    description:
      "Backfill a missing status as inactive when the legacy flag is false.",
    filter: {
      $and: [MISSING_STATUS_FILTER, { isActive: false }],
    },
    set: { status: "inactive", isActive: false },
  },
  {
    id: "missing_status_to_active",
    description:
      "Backfill a missing status as active when there is no explicit false flag.",
    filter: {
      $and: [MISSING_STATUS_FILTER, { isActive: { $ne: false } }],
    },
    set: { status: "active", isActive: true },
  },
]);

export const getCanonicalMembershipRepair = (membership) => {
  const { status, isActive } = membership;

  if (status !== undefined && status !== null) {
    if (!VALID_MEMBERSHIP_STATUSES.includes(status)) {
      return {
        classification: "invalid_status",
        patch: null,
      };
    }

    if (status === "active" && isActive === false) {
      return {
        classification: "active_false_to_inactive",
        patch: { status: "inactive", isActive: false },
      };
    }

    const canonicalIsActive = status === "active";
    if (isActive !== canonicalIsActive) {
      return {
        classification: `${status}_derive_${canonicalIsActive}`,
        patch: { status, isActive: canonicalIsActive },
      };
    }

    return { classification: "consistent", patch: null };
  }

  if (isActive === false) {
    return {
      classification: "missing_status_false_to_inactive",
      patch: { status: "inactive", isActive: false },
    };
  }

  return {
    classification: "missing_status_to_active",
    patch: { status: "active", isActive: true },
  };
};

export const auditCompanyMembershipCollection = async (collection) => {
  const [total, invalidStatus, ...repairCounts] = await Promise.all([
    collection.countDocuments({}),
    collection.countDocuments(INVALID_STATUS_FILTER),
    ...MEMBERSHIP_REPAIR_RULES.map((rule) =>
      collection.countDocuments(rule.filter)
    ),
  ]);

  const repairs = Object.fromEntries(
    MEMBERSHIP_REPAIR_RULES.map((rule, index) => [
      rule.id,
      repairCounts[index],
    ])
  );
  const repairTotal = repairCounts.reduce((sum, count) => sum + count, 0);

  return {
    total,
    consistent: total - invalidStatus - repairTotal,
    invalidStatus,
    repairTotal,
    repairs,
  };
};

export const backfillCompanyMembershipCollection = async (
  collection,
  { audit, now = new Date() } = {}
) => {
  const before = audit || (await auditCompanyMembershipCollection(collection));

  if (before.invalidStatus > 0) {
    const error = new Error(
      "Backfill refused because memberships with invalid status values require manual review."
    );
    error.code = "INVALID_MEMBERSHIP_STATUS";
    error.audit = before;
    throw error;
  }

  const results = {};

  for (const rule of MEMBERSHIP_REPAIR_RULES) {
    const result = await collection.updateMany(rule.filter, {
      $set: {
        ...rule.set,
        updatedAt: now,
      },
    });

    results[rule.id] = {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  }

  return results;
};

export const parseMigrationMode = (args) => {
  const supported = new Set(["--apply"]);
  const unknown = args.filter((argument) => !supported.has(argument));

  if (unknown.length) {
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  }

  return args.includes("--apply") ? "apply" : "audit";
};

const getInvalidStatusSamples = async (collection) =>
  collection
    .find(INVALID_STATUS_FILTER)
    .project({ _id: 1, companyId: 1, userId: 1, status: 1, isActive: 1 })
    .limit(20)
    .toArray();

const run = async () => {
  const mode = parseMigrationMode(process.argv.slice(2));

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required.");
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const collection = CompanyMembership.collection;
    const before = await auditCompanyMembershipCollection(collection);
    const invalidStatusSamples =
      before.invalidStatus > 0
        ? await getInvalidStatusSamples(collection)
        : [];

    if (mode === "audit") {
      console.log(
        JSON.stringify(
          {
            mode,
            applied: false,
            audit: before,
            invalidStatusSamples,
            nextStep:
              before.invalidStatus > 0
                ? "Review invalid status records before applying."
                : "Run npm run membership:backfill to apply these repairs.",
          },
          null,
          2
        )
      );
      return;
    }

    const results = await backfillCompanyMembershipCollection(collection, {
      audit: before,
    });
    const after = await auditCompanyMembershipCollection(collection);

    if (after.invalidStatus > 0 || after.repairTotal > 0) {
      const error = new Error(
        "Post-backfill audit failed; membership state is not canonical."
      );
      error.code = "MEMBERSHIP_BACKFILL_INCOMPLETE";
      error.audit = after;
      throw error;
    }

    console.log(
      JSON.stringify(
        {
          mode,
          applied: true,
          before,
          results,
          after,
        },
        null,
        2
      )
    );
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
          code: error.code || "MEMBERSHIP_MIGRATION_FAILED",
          message: error.message,
          audit: error.audit,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  });
}
