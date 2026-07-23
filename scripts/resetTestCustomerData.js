import dotenv from "dotenv";
import mongoose from "mongoose";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import User from "../models/user.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const CONFIRMATION = process.env.RESET_TEST_DATA_CONFIRMATION;
const REQUIRED_CONFIRMATION = "DELETE_TEST_CUSTOMER_DATA";

const normalize = (value) => String(value || "").trim().toLowerCase();
const objectIds = (documents) => documents.map((document) => document._id);
const stringifyIds = (values) => values.map((value) => String(value));

const getTerrapeakCandidates = async () => {
  const organizations = await Organization.find({}).lean();
  const companies = await Company.find({}).lean();

  const organizationCandidates = organizations.filter((organization) => {
    const values = [organization.name, organization.slug].map(normalize);
    return values.some(
      (value) => value === "terrapeak" || value === "terrapeak group"
    );
  });

  const companyCandidates = companies.filter((company) => {
    const values = [company.name, company.displayName, company.slug].map(
      normalize
    );
    return values.some(
      (value) => value === "terrapeak" || value === "terrapeak group"
    );
  });

  return { organizationCandidates, companyCandidates };
};

const assertSingleTerrapeakRecord = (records, label) => {
  if (records.length !== 1) {
    throw new Error(
      `Expected exactly one Terrapeak ${label}, found ${records.length}. ` +
        `No data was changed. Set the records up correctly before retrying.`
    );
  }
  return records[0];
};

const getDependentCollectionPlan = async ({
  fakeOrganizationIds,
  fakeCompanyIds,
  fakeUserIds,
}) => {
  const protectedCollections = new Set([
    Organization.collection.name,
    Company.collection.name,
    User.collection.name,
    OrganizationMembership.collection.name,
    CompanyMembership.collection.name,
  ]);

  const organizationFields = [
    "organizationId",
    "organization._id",
    "organization.id",
  ];
  const companyFields = ["companyId", "company._id", "company.id"];
  const userFields = [
    "userId",
    "ownerUserId",
    "createdByUserId",
    "assignedToUserId",
  ];

  const buildConditions = (fields, ids) =>
    ids.length ? fields.map((field) => ({ [field]: { $in: ids } })) : [];

  const conditions = [
    ...buildConditions(organizationFields, fakeOrganizationIds),
    ...buildConditions(companyFields, fakeCompanyIds),
    ...buildConditions(userFields, fakeUserIds),
  ];

  if (!conditions.length) return [];

  const collections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const plan = [];

  for (const { name } of collections) {
    if (protectedCollections.has(name) || name.startsWith("system.")) continue;
    const collection = mongoose.connection.db.collection(name);
    const filter = { $or: conditions };
    const count = await collection.countDocuments(filter);
    if (count > 0) plan.push({ name, count, filter });
  }

  return plan.sort((left, right) => left.name.localeCompare(right.name));
};

const buildResetPlan = async () => {
  const { organizationCandidates, companyCandidates } =
    await getTerrapeakCandidates();
  const terrapeakOrganization = assertSingleTerrapeakRecord(
    organizationCandidates,
    "organization"
  );
  const terrapeakCompany = assertSingleTerrapeakRecord(
    companyCandidates,
    "company"
  );

  if (
    terrapeakCompany.organizationId &&
    String(terrapeakCompany.organizationId) !==
      String(terrapeakOrganization._id)
  ) {
    throw new Error(
      "The Terrapeak company is linked to a different organization. " +
        "No data was changed. Correct this relationship first."
    );
  }

  const [organizations, companies, users, organizationMemberships, companyMemberships] =
    await Promise.all([
      Organization.find({}).lean(),
      Company.find({}).lean(),
      User.find({}).lean(),
      OrganizationMembership.find({}).lean(),
      CompanyMembership.find({}).lean(),
    ]);

  const fakeOrganizations = organizations.filter(
    (organization) =>
      String(organization._id) !== String(terrapeakOrganization._id)
  );
  const fakeCompanies = companies.filter(
    (company) => String(company._id) !== String(terrapeakCompany._id)
  );

  const preservedOrganizationMemberships = organizationMemberships.filter(
    (membership) =>
      String(membership.organizationId) === String(terrapeakOrganization._id)
  );
  const preservedCompanyMemberships = companyMemberships.filter(
    (membership) =>
      String(membership.companyId) === String(terrapeakCompany._id)
  );

  const preservedUserIds = new Set([
    ...preservedOrganizationMemberships.map((membership) =>
      String(membership.userId)
    ),
    ...preservedCompanyMemberships.map((membership) => String(membership.userId)),
    ...users
      .filter(
        (user) => user.platformRole && user.platformRole !== "none"
      )
      .map((user) => String(user._id)),
  ]);

  const fakeUsers = users.filter(
    (user) => !preservedUserIds.has(String(user._id))
  );
  const fakeOrganizationIds = objectIds(fakeOrganizations);
  const fakeCompanyIds = objectIds(fakeCompanies);
  const fakeUserIds = objectIds(fakeUsers);

  const dependentCollections = await getDependentCollectionPlan({
    fakeOrganizationIds,
    fakeCompanyIds,
    fakeUserIds,
  });

  return {
    preserve: {
      organization: {
        id: String(terrapeakOrganization._id),
        name: terrapeakOrganization.name,
        slug: terrapeakOrganization.slug,
      },
      company: {
        id: String(terrapeakCompany._id),
        name: terrapeakCompany.displayName || terrapeakCompany.name,
        slug: terrapeakCompany.slug,
      },
      userIds: [...preservedUserIds],
    },
    delete: {
      organizations: fakeOrganizations,
      companies: fakeCompanies,
      users: fakeUsers,
      organizationMemberships: organizationMemberships.filter(
        (membership) =>
          String(membership.organizationId) !==
          String(terrapeakOrganization._id)
      ),
      companyMemberships: companyMemberships.filter(
        (membership) =>
          String(membership.companyId) !== String(terrapeakCompany._id)
      ),
      dependentCollections,
    },
  };
};

const printPlan = (plan) => {
  const summary = {
    mode: APPLY ? "apply" : "dry-run",
    preserved: plan.preserve,
    deleteCounts: {
      organizations: plan.delete.organizations.length,
      companies: plan.delete.companies.length,
      users: plan.delete.users.length,
      organizationMemberships: plan.delete.organizationMemberships.length,
      companyMemberships: plan.delete.companyMemberships.length,
      dependentDocuments: plan.delete.dependentCollections.reduce(
        (total, collection) => total + collection.count,
        0
      ),
    },
    deleteRecords: {
      organizations: plan.delete.organizations.map((item) => ({
        id: String(item._id),
        name: item.name,
        slug: item.slug,
      })),
      companies: plan.delete.companies.map((item) => ({
        id: String(item._id),
        name: item.displayName || item.name,
        slug: item.slug,
      })),
      users: plan.delete.users.map((item) => ({
        id: String(item._id),
        email: item.email,
        name: item.name || item.fullName,
      })),
      dependentCollections: plan.delete.dependentCollections.map(
        ({ name, count }) => ({ name, count })
      ),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
};

const applyResetPlan = async (plan) => {
  if (CONFIRMATION !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `Apply mode requires RESET_TEST_DATA_CONFIRMATION=${REQUIRED_CONFIRMATION}.`
    );
  }

  for (const { name, filter } of plan.delete.dependentCollections) {
    await mongoose.connection.db.collection(name).deleteMany(filter);
  }

  await CompanyMembership.deleteMany({
    _id: { $in: objectIds(plan.delete.companyMemberships) },
  });
  await OrganizationMembership.deleteMany({
    _id: { $in: objectIds(plan.delete.organizationMemberships) },
  });
  await User.deleteMany({ _id: { $in: objectIds(plan.delete.users) } });
  await Company.deleteMany({ _id: { $in: objectIds(plan.delete.companies) } });
  await Organization.deleteMany({
    _id: { $in: objectIds(plan.delete.organizations) },
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        message: "Test customer data reset completed.",
        preservedOrganizationId: plan.preserve.organization.id,
        preservedCompanyId: plan.preserve.company.id,
        deletedOrganizationIds: stringifyIds(
          objectIds(plan.delete.organizations)
        ),
        deletedCompanyIds: stringifyIds(objectIds(plan.delete.companies)),
        deletedUserIds: stringifyIds(objectIds(plan.delete.users)),
      },
      null,
      2
    )
  );
};

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const plan = await buildResetPlan();
    printPlan(plan);
    if (APPLY) await applyResetPlan(plan);
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        code: "TEST_CUSTOMER_DATA_RESET_FAILED",
        message: error.message,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
