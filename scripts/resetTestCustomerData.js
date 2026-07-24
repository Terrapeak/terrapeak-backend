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
const idSet = (documents) => new Set(documents.map((document) => String(document._id)));

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

  const [
    organizations,
    companies,
    users,
    organizationMemberships,
    companyMemberships,
  ] = await Promise.all([
    Organization.find({}).lean(),
    Company.find({}).lean(),
    User.find({}).lean(),
    OrganizationMembership.find({}).lean(),
    CompanyMembership.find({}).lean(),
  ]);

  const platformCompanies = companies.filter(
    (company) => company.isPlatformWorkspace === true
  );

  if (platformCompanies.length !== 1) {
    throw new Error(
      `Expected exactly one Platform workspace, found ${platformCompanies.length}. ` +
        "No data was changed. Repair Platform integrity before retrying."
    );
  }

  const platformCompany = platformCompanies[0];

  if (String(platformCompany._id) === String(terrapeakCompany._id)) {
    throw new Error(
      "The Terrapeak customer company is still marked as the Platform workspace. " +
        "No data was changed. Separate the workspaces before retrying."
    );
  }

  const preservedOrganizationIds = new Set([
    String(terrapeakOrganization._id),
  ]);
  const preservedCompanyIds = new Set([
    String(terrapeakCompany._id),
    String(platformCompany._id),
  ]);

  const preservedOrganizationMemberships = organizationMemberships.filter(
    (membership) =>
      preservedOrganizationIds.has(String(membership.organizationId))
  );
  const preservedCompanyMemberships = companyMemberships.filter((membership) =>
    preservedCompanyIds.has(String(membership.companyId))
  );

  const preservedUserIds = new Set([
    ...preservedOrganizationMemberships.map((membership) =>
      String(membership.userId)
    ),
    ...preservedCompanyMemberships.map((membership) => String(membership.userId)),
    String(terrapeakCompany.ownerUserId),
    String(platformCompany.ownerUserId),
    ...users
      .filter((user) => user.platformRole && user.platformRole !== "none")
      .map((user) => String(user._id)),
  ]);

  const fakeOrganizations = organizations.filter(
    (organization) =>
      !preservedOrganizationIds.has(String(organization._id))
  );
  const fakeCompanies = companies.filter(
    (company) => !preservedCompanyIds.has(String(company._id))
  );
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

  const deleteOrganizationMemberships = organizationMemberships.filter(
    (membership) =>
      !preservedOrganizationIds.has(String(membership.organizationId))
  );
  const deleteCompanyMemberships = companyMemberships.filter(
    (membership) => !preservedCompanyIds.has(String(membership.companyId))
  );

  const deletedCompanyIdSet = idSet(fakeCompanies);
  if (deletedCompanyIdSet.has(String(platformCompany._id))) {
    throw new Error(
      "Safety check failed: the Platform workspace entered the deletion plan. No data was changed."
    );
  }

  const deletedCompanyMembershipIdSet = idSet(deleteCompanyMemberships);
  for (const membership of preservedCompanyMemberships) {
    if (deletedCompanyMembershipIdSet.has(String(membership._id))) {
      throw new Error(
        "Safety check failed: a protected company membership entered the deletion plan. No data was changed."
      );
    }
  }

  return {
    preserve: {
      organization: {
        id: String(terrapeakOrganization._id),
        name: terrapeakOrganization.name,
        slug: terrapeakOrganization.slug,
      },
      customerCompany: {
        id: String(terrapeakCompany._id),
        name: terrapeakCompany.displayName || terrapeakCompany.name,
        slug: terrapeakCompany.slug,
      },
      platformCompany: {
        id: String(platformCompany._id),
        name: platformCompany.displayName || platformCompany.name,
        slug: platformCompany.slug,
        ownerUserId: String(platformCompany.ownerUserId),
      },
      userIds: [...preservedUserIds],
    },
    delete: {
      organizations: fakeOrganizations,
      companies: fakeCompanies,
      users: fakeUsers,
      organizationMemberships: deleteOrganizationMemberships,
      companyMemberships: deleteCompanyMemberships,
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

const deleteByIds = async (collection, documents) => {
  const ids = objectIds(documents);
  if (!ids.length) return;
  await collection.deleteMany({ _id: { $in: ids } });
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

  await deleteByIds(
    CompanyMembership.collection,
    plan.delete.companyMemberships
  );
  await deleteByIds(
    OrganizationMembership.collection,
    plan.delete.organizationMemberships
  );
  await deleteByIds(User.collection, plan.delete.users);
  await deleteByIds(Company.collection, plan.delete.companies);
  await deleteByIds(Organization.collection, plan.delete.organizations);

  console.log(
    JSON.stringify(
      {
        success: true,
        message: "Test customer data reset completed.",
        preservedOrganizationId: plan.preserve.organization.id,
        preservedCustomerCompanyId: plan.preserve.customerCompany.id,
        preservedPlatformCompanyId: plan.preserve.platformCompany.id,
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
