import dotenv from "dotenv";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

import Company from "../models/company.js";
import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import User from "../models/user.js";

dotenv.config();

const SAMPLE_LIMIT = 10;

const facetPipeline = (pipeline) => [
  ...pipeline,
  {
    $facet: {
      count: [{ $count: "value" }],
      samples: [{ $limit: SAMPLE_LIMIT }],
    },
  },
];

export const buildOrganizationHardeningChecks = ({
  models = { User, Organization, OrganizationMembership, Company },
} = {}) => {
  const usersCollection = models.User.collection.name;
  const organizationsCollection = models.Organization.collection.name;

  return [
    {
      id: "active_membership_platform_role_conflicts",
      model: models.OrganizationMembership,
      pipeline: [
        { $match: { status: "active" } },
        {
          $lookup: {
            from: usersCollection,
            localField: "userId",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: "$user" },
        {
          $match: {
            "user.platformRole": { $nin: ["none", null] },
          },
        },
        {
          $project: {
            _id: 0,
            membershipId: "$_id",
            organizationId: 1,
            userId: 1,
          },
        },
      ],
    },
    {
      id: "active_membership_legacy_admin_conflicts",
      model: models.OrganizationMembership,
      pipeline: [
        { $match: { status: "active" } },
        {
          $lookup: {
            from: usersCollection,
            localField: "userId",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: "$user" },
        { $match: { "user.isAdmin": true } },
        {
          $project: {
            _id: 0,
            membershipId: "$_id",
            organizationId: 1,
            userId: 1,
          },
        },
      ],
    },
    {
      id: "organizations_missing_active_owner",
      model: models.OrganizationMembership,
      pipeline: [
        { $match: { role: "owner" } },
        {
          $group: {
            _id: "$organizationId",
            activeOwners: {
              $sum: {
                $cond: [{ $eq: ["$status", "active"] }, 1, 0],
              },
            },
            ownerRecords: { $sum: 1 },
          },
        },
        { $match: { activeOwners: 0, ownerRecords: { $gt: 0 } } },
        { $project: { _id: 0, organizationId: "$_id" } },
      ],
    },
    {
      id: "duplicate_active_organization_memberships",
      model: models.OrganizationMembership,
      pipeline: [
        { $match: { status: "active" } },
        {
          $group: {
            _id: {
              organizationId: "$organizationId",
              userId: "$userId",
            },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
        {
          $project: {
            _id: 0,
            organizationId: "$_id.organizationId",
            userId: "$_id.userId",
            count: 1,
          },
        },
      ],
    },
    {
      id: "companies_with_missing_organization",
      model: models.Company,
      pipeline: [
        { $match: { organizationId: { $ne: null } } },
        {
          $lookup: {
            from: organizationsCollection,
            localField: "organizationId",
            foreignField: "_id",
            as: "organization",
          },
        },
        { $match: { organization: { $size: 0 } } },
        {
          $project: {
            _id: 0,
            companyId: "$_id",
            organizationId: 1,
          },
        },
      ],
    },
    {
      id: "memberships_with_missing_user",
      model: models.OrganizationMembership,
      pipeline: [
        {
          $lookup: {
            from: usersCollection,
            localField: "userId",
            foreignField: "_id",
            as: "user",
          },
        },
        { $match: { user: { $size: 0 } } },
        {
          $project: {
            _id: 0,
            membershipId: "$_id",
            userId: 1,
            organizationId: 1,
          },
        },
      ],
    },
    {
      id: "memberships_with_missing_organization",
      model: models.OrganizationMembership,
      pipeline: [
        {
          $lookup: {
            from: organizationsCollection,
            localField: "organizationId",
            foreignField: "_id",
            as: "organization",
          },
        },
        { $match: { organization: { $size: 0 } } },
        {
          $project: {
            _id: 0,
            membershipId: "$_id",
            userId: 1,
            organizationId: 1,
          },
        },
      ],
    },
    {
      id: "invalid_organization_statuses",
      model: models.Organization,
      pipeline: [
        {
          $match: {
            status: { $nin: ["active", "inactive", "archived"] },
          },
        },
        { $project: { _id: 0, organizationId: "$_id" } },
      ],
    },
    {
      id: "invalid_organization_membership_statuses",
      model: models.OrganizationMembership,
      pipeline: [
        {
          $match: {
            status: { $nin: ["active", "inactive", "removed"] },
          },
        },
        {
          $project: {
            _id: 0,
            membershipId: "$_id",
            organizationId: 1,
            userId: 1,
          },
        },
      ],
    },
    {
      id: "organization_status_contradictions",
      model: models.Organization,
      pipeline: [
        {
          $match: {
            $or: [
              { status: "active", isActive: { $ne: true } },
              {
                status: { $in: ["inactive", "archived"] },
                isActive: { $ne: false },
              },
            ],
          },
        },
        { $project: { _id: 0, organizationId: "$_id" } },
      ],
    },
    {
      id: "organization_membership_status_contradictions",
      model: models.OrganizationMembership,
      pipeline: [
        {
          $match: {
            $or: [
              { status: "active", isActive: { $ne: true } },
              {
                status: { $in: ["inactive", "removed"] },
                isActive: { $ne: false },
              },
            ],
          },
        },
        {
          $project: {
            _id: 0,
            membershipId: "$_id",
            organizationId: 1,
            userId: 1,
          },
        },
      ],
    },
  ];
};

const safeJson = (value) =>
  JSON.parse(
    JSON.stringify(value, (_key, item) =>
      item instanceof mongoose.Types.ObjectId ? item.toString() : item
    )
  );

export const auditOrganizationHardening = async ({ models } = {}) => {
  const checks = buildOrganizationHardeningChecks({ models });
  const findings = [];

  for (const check of checks) {
    const [result = {}] = await check.model.aggregate(
      facetPipeline(check.pipeline)
    );
    findings.push({
      id: check.id,
      count: result.count?.[0]?.value || 0,
      samples: safeJson(result.samples || []),
    });
  }

  return {
    ok: findings.every((finding) => finding.count === 0),
    findings,
  };
};

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const report = await auditOrganizationHardening();
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
          code: "ORGANIZATION_HARDENING_AUDIT_FAILED",
          message: error.message,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  });
}
