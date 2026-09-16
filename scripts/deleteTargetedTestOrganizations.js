import mongoose from "mongoose";

const TARGET_NAMES = [
  "General demo company",
  "Northside Dental Clinic test",
  "Terrapeak sales 4",
  "Demo learning Centre",
  "Demo Physio Company",
  "Dentist Demo Company",
  "Terrapeak digital agency",
];
const APPLY_MODE = process.env.TARGETED_CUSTOMER_CLEANUP_MODE === "apply";
const CONFIRMATION =
  process.env.TARGETED_CUSTOMER_CLEANUP_CONFIRMATION;
const REQUIRED_CONFIRMATION =
  "DELETE_THE_SEVEN_CONFIRMED_TEST_ORGANIZATIONS";
const ORG_FIELDS = ["organizationId", "organization._id", "organization.id"];
const COMPANY_FIELDS = ["companyId", "company._id", "company.id"];
const USER_FIELDS = [
  "userId",
  "ownerUserId",
  "createdByUserId",
  "assignedToUserId",
];
const PROTECTED_COLLECTIONS = new Set([
  "organizations",
  "companies",
  "users",
  "organizationmemberships",
  "companymemberships",
]);

const asString = (value) => (value == null ? null : String(value));
const uniqueStrings = (values) => [
  ...new Set(values.filter(Boolean).map(asString)),
];
const asObjectIds = (values) =>
  uniqueStrings(values)
    .filter((value) => mongoose.isValidObjectId(value))
    .map((value) => new mongoose.Types.ObjectId(value));
const idList = (documents) => documents.map((document) => document._id);
const publicDoc = (document) => {
  const output = { ...document, id: asString(document._id) };
  delete output._id;
  return output;
};
const idFilter = (ids) => ({ $in: ids });
const fieldFilters = (fields, ids) =>
  ids.length ? fields.map((field) => ({ [field]: idFilter(ids) })) : [];

const fail = (message) => {
  const error = new Error(message);
  error.code = "TARGETED_CUSTOMER_CLEANUP_SAFETY_FAILURE";
  throw error;
};

const collectionPlan = async ({
  db,
  organizationIds,
  companyIds,
  userIds,
}) => {
  const fieldsAndIds = [
    ...ORG_FIELDS.map((field) => [field, organizationIds]),
    ...COMPANY_FIELDS.map((field) => [field, companyIds]),
    ...USER_FIELDS.map((field) => [field, userIds]),
  ];
  const conditions = fieldsAndIds.flatMap(([field, ids]) =>
    fieldFilters([field], ids)
  );
  const plan = [];
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();

  for (const { name } of collections) {
    if (PROTECTED_COLLECTIONS.has(name) || name.startsWith("system.")) {
      continue;
    }
    const collection = db.collection(name);
    const countsByField = {};
    for (const [field, ids] of fieldsAndIds) {
      if (!ids.length) continue;
      const count = await collection.countDocuments({
        [field]: idFilter(ids),
      });
      if (count > 0) countsByField[field] = count;
    }
    if (Object.keys(countsByField).length > 0) {
      plan.push({
        collection: name,
        countsByField,
        total: Object.values(countsByField).reduce(
          (total, count) => total + count,
          0
        ),
      });
    }
  }
  return plan.sort((left, right) =>
    left.collection.localeCompare(right.collection)
  );
};

const distinctUserIdsInDependents = async ({
  db,
  organizationIds,
  companyIds,
}) => {
  const result = [];
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const relationshipFilters = [
    ...fieldFilters(ORG_FIELDS, organizationIds),
    ...fieldFilters(COMPANY_FIELDS, companyIds),
  ];
  if (!relationshipFilters.length) return [];
  for (const { name } of collections) {
    if (PROTECTED_COLLECTIONS.has(name) || name.startsWith("system.")) {
      continue;
    }
    const collection = db.collection(name);
    const relationshipFilter = { $or: relationshipFilters };
    for (const field of USER_FIELDS) {
      const values = await collection.distinct(field, relationshipFilter);
      result.push(...values);
    }
  }
  return uniqueStrings(result);
};

const getPlan = async (db) => {
  const organizations = await db
    .collection("organizations")
    .find({ name: { $in: TARGET_NAMES } })
    .project({
      _id: 1,
      name: 1,
      slug: 1,
      organizationType: 1,
      status: 1,
      createdByUserId: 1,
    })
    .toArray();

  const matchedNames = organizations.map((organization) => organization.name);
  if (
    organizations.length > 0 &&
    (organizations.length !== TARGET_NAMES.length ||
      new Set(matchedNames).size !== TARGET_NAMES.length ||
      TARGET_NAMES.some((name) => !matchedNames.includes(name)))
  ) {
    fail(
      `Expected exactly the seven allowlisted organizations, found: ${matchedNames.join(
        ", "
      )}`
    );
  }

  const organizationIds = idList(organizations);
  const companies = await db
    .collection("companies")
    .find({ organizationId: idFilter(organizationIds) })
    .project({
      _id: 1,
      name: 1,
      displayName: 1,
      slug: 1,
      organizationId: 1,
      ownerUserId: 1,
      isPlatformWorkspace: 1,
    })
    .toArray();
  if (companies.some((company) => company.isPlatformWorkspace === true)) {
    fail("Platform workspace entered the deletion set.");
  }

  const companyIds = idList(companies);
  const organizationMemberships = await db
    .collection("organizationmemberships")
    .find({ organizationId: idFilter(organizationIds) })
    .project({
      _id: 1,
      organizationId: 1,
      userId: 1,
      role: 1,
      status: 1,
    })
    .toArray();
  const companyMemberships = await db
    .collection("companymemberships")
    .find({ companyId: idFilter(companyIds) })
    .project({ _id: 1, companyId: 1, userId: 1, role: 1, status: 1 })
    .toArray();

  const dependentUserIds = await distinctUserIdsInDependents({
    db,
    organizationIds,
    companyIds,
  });
  const candidateUserIds = asObjectIds([
    ...organizationMemberships.map((membership) => membership.userId),
    ...companyMemberships.map((membership) => membership.userId),
    ...companies.map((company) => company.ownerUserId),
    ...organizations.map((organization) => organization.createdByUserId),
    ...dependentUserIds,
  ]);
  const users = await db
    .collection("users")
    .find({ _id: idFilter(candidateUserIds) })
    .project({
      _id: 1,
      name: 1,
      email: 1,
      platformRole: 1,
      isAdmin: 1,
      role: 1,
      accountStatus: 1,
    })
    .toArray();

  const targetOrgIdSet = new Set(organizationIds.map(asString));
  const targetCompanyIdSet = new Set(companyIds.map(asString));
  const retainedOrganizationMemberships = await db
    .collection("organizationmemberships")
    .find({ organizationId: { $nin: organizationIds } })
    .project({ userId: 1 })
    .toArray();
  const retainedCompanyMemberships = await db
    .collection("companymemberships")
    .find({ companyId: { $nin: companyIds } })
    .project({ userId: 1 })
    .toArray();
  const retainedOwners = await db
    .collection("companies")
    .find({ _id: { $nin: companyIds } })
    .project({ ownerUserId: 1 })
    .toArray();
  const retainedCreators = await db
    .collection("organizations")
    .find({ _id: { $nin: organizationIds } })
    .project({ createdByUserId: 1 })
    .toArray();
  const retainedUserIds = new Set([
    ...retainedOrganizationMemberships.map((membership) =>
      asString(membership.userId)
    ),
    ...retainedCompanyMemberships.map((membership) =>
      asString(membership.userId)
    ),
    ...retainedOwners.map((company) => asString(company.ownerUserId)),
    ...retainedCreators.map((organization) =>
      asString(organization.createdByUserId)
    ),
  ]);
  const preservedUsers = users.filter(
    (user) =>
      user.isAdmin === true ||
      (user.platformRole && user.platformRole !== "none") ||
      retainedUserIds.has(asString(user._id))
  );
  const deletedUsers = users.filter(
    (user) => !preservedUsers.some((preserved) => asString(preserved._id) === asString(user._id))
  );
  if (
    deletedUsers.some(
      (user) =>
        user.isAdmin === true ||
        (user.platformRole && user.platformRole !== "none") ||
        retainedUserIds.has(asString(user._id))
    )
  ) {
    fail("A platform, admin, shared, or retained user entered user deletion.");
  }

  const realTerraPeakOrganizations = await db
    .collection("organizations")
    .find({
      $or: [
        { name: { $regex: "^terrapeak( group)?$", $options: "i" } },
        { slug: { $regex: "^terrapeak(-group)?$", $options: "i" } },
      ],
    })
    .project({ _id: 1, name: 1, slug: 1 })
    .toArray();
  if (
    realTerraPeakOrganizations.some((organization) =>
      targetOrgIdSet.has(asString(organization._id))
    )
  ) {
    fail("The real TerraPeak organization entered the deletion set.");
  }

  const realTerraPeakCompanies = await db
    .collection("companies")
    .find({
      $or: [
        { name: { $regex: "^terrapeak( group)?$", $options: "i" } },
        { displayName: { $regex: "^terrapeak( group)?$", $options: "i" } },
        { slug: { $regex: "^terrapeak(-group)?$", $options: "i" } },
      ],
    })
    .project({
      _id: 1,
      name: 1,
      displayName: 1,
      slug: 1,
      organizationId: 1,
      isPlatformWorkspace: 1,
      ownerUserId: 1,
    })
    .toArray();
  if (
    realTerraPeakCompanies.some((company) =>
      targetCompanyIdSet.has(asString(company._id))
    )
  ) {
    fail("The real TerraPeak company entered the deletion set.");
  }

  const platformCompanies = await db
    .collection("companies")
    .find({ isPlatformWorkspace: true })
    .project({
      _id: 1,
      name: 1,
      displayName: 1,
      slug: 1,
      organizationId: 1,
      ownerUserId: 1,
    })
    .toArray();
  const platformUsersBefore = await db
    .collection("users")
    .find({
      $or: [
        { isAdmin: true },
        { platformRole: { $exists: true, $nin: [null, "none"] } },
      ],
    })
    .project({ _id: 1, name: 1, email: 1, platformRole: 1, isAdmin: 1 })
    .toArray();
  const dependents = await collectionPlan({
    db,
    organizationIds,
    companyIds,
    userIds: idList(deletedUsers),
  });

  return {
    organizations,
    companies,
    organizationMemberships,
    companyMemberships,
    users,
    deletedUsers,
    preservedUsers,
    organizationIds,
    companyIds,
    dependents,
    sentinels: {
      realTerraPeakOrganizations,
      realTerraPeakCompanies,
      platformCompanies,
      platformUsersBefore,
    },
  };
};

const deletePlan = async (db, plan) => {
  if (!APPLY_MODE || CONFIRMATION !== REQUIRED_CONFIRMATION) {
    return { applied: false, deleted: {} };
  }
  for (const dependent of plan.dependents) {
    const ids = [];
    const filters = [
      ...fieldFilters(ORG_FIELDS, plan.organizationIds),
      ...fieldFilters(COMPANY_FIELDS, plan.companyIds),
      ...fieldFilters(USER_FIELDS, idList(plan.deletedUsers)),
    ];
    const result = await db.collection(dependent.collection).deleteMany({
      $or: filters,
    });
    ids.push(result.deletedCount);
  }
  const companyMemberships = await db
    .collection("companymemberships")
    .deleteMany({ _id: idFilter(idList(plan.companyMemberships)) });
  const organizationMemberships = await db
    .collection("organizationmemberships")
    .deleteMany({ _id: idFilter(idList(plan.organizationMemberships)) });
  const companies = await db
    .collection("companies")
    .deleteMany({ _id: idFilter(plan.companyIds) });
  const organizations = await db
    .collection("organizations")
    .deleteMany({ _id: idFilter(plan.organizationIds) });
  const users = await db
    .collection("users")
    .deleteMany({ _id: idFilter(idList(plan.deletedUsers)) });
  return {
    applied: true,
    deleted: {
      dependentDocuments: dependents.reduce(
        (total, dependent) => total + dependent.total,
        0
      ),
      companyMemberships: companyMemberships.deletedCount,
      organizationMemberships: organizationMemberships.deletedCount,
      companies: companies.deletedCount,
      organizations: organizations.deletedCount,
      users: users.deletedCount,
    },
  };
};

const verify = async (db, plan) => {
  const targetNamesRemaining = await db
    .collection("organizations")
    .countDocuments({ name: { $in: TARGET_NAMES } });
  const companiesRemaining = await db
    .collection("companies")
    .countDocuments({ organizationId: idFilter(plan.organizationIds) });
  const organizationMembershipsRemaining = await db
    .collection("organizationmemberships")
    .countDocuments({ organizationId: idFilter(plan.organizationIds) });
  const companyMembershipsRemaining = await db
    .collection("companymemberships")
    .countDocuments({ companyId: idFilter(plan.companyIds) });
  const dependentCollections = await collectionPlan({
    db,
    organizationIds: plan.organizationIds,
    companyIds: plan.companyIds,
    userIds: idList(plan.deletedUsers),
  });
  const orphanDeletedUsers = await db
    .collection("users")
    .countDocuments({ _id: idFilter(idList(plan.deletedUsers)) });
  const realTerraPeakOrganizations = await db
    .collection("organizations")
    .countDocuments({
      $or: [
        { name: { $regex: "^terrapeak( group)?$", $options: "i" } },
        { slug: { $regex: "^terrapeak(-group)?$", $options: "i" } },
      ],
    });
  const platformCompanies = await db
    .collection("companies")
    .countDocuments({ isPlatformWorkspace: true });
  const platformUsers = await db.collection("users").countDocuments({
    $or: [
      { isAdmin: true },
      { platformRole: { $exists: true, $nin: [null, "none"] } },
    ],
  });
  const result = {
    targetNamesRemaining,
    companiesRemaining,
    organizationMembershipsRemaining,
    companyMembershipsRemaining,
    dependentCollections,
    orphanDeletedUsers,
    realTerraPeakOrganizations,
    platformCompanies,
    platformUsers,
  };
  if (
    targetNamesRemaining !== 0 ||
    companiesRemaining !== 0 ||
    organizationMembershipsRemaining !== 0 ||
    companyMembershipsRemaining !== 0 ||
    dependentCollections.length !== 0 ||
    orphanDeletedUsers !== 0 ||
    realTerraPeakOrganizations < 1 ||
    platformCompanies < 1 ||
    platformUsers < 1
  ) {
    fail(`Post-cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
};

const run = async () => {
  console.log("TARGETED_CUSTOMER_CLEANUP_START=1");
  if (!process.env.MONGO_URI) fail("MONGO_URI is required.");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const plan = await getPlan(mongoose.connection.db);
    const summary = {
      mode:
        APPLY_MODE && CONFIRMATION === REQUIRED_CONFIRMATION
          ? "apply"
          : "dry-run",
      organizationsMatched: plan.organizations.map(publicDoc),
      companies: plan.companies.map(publicDoc),
      organizationMemberships: plan.organizationMemberships.map(publicDoc),
      companyMemberships: plan.companyMemberships.map(publicDoc),
      usersProposedForDeletion: plan.deletedUsers.map(publicDoc),
      usersPreserved: plan.preservedUsers.map(publicDoc),
      dependentCollections: plan.dependents,
      sentinels: {
        realTerraPeakOrganizations: plan.sentinels.realTerraPeakOrganizations.map(publicDoc),
        realTerraPeakCompanies: plan.sentinels.realTerraPeakCompanies.map(publicDoc),
        platformCompanies: plan.sentinels.platformCompanies.map(publicDoc),
        platformUserCount: plan.sentinels.platformUsersBefore.length,
      },
    };
    console.log(
      "TARGETED_CUSTOMER_CLEANUP_PLAN=" + JSON.stringify(summary)
    );
    const deletion = await deletePlan(mongoose.connection.db, plan);
    if (deletion.applied) {
      console.log(
        "TARGETED_CUSTOMER_CLEANUP_DELETION=" +
          JSON.stringify(deletion)
      );
      const verification = await verify(mongoose.connection.db, plan);
      console.log(
        "TARGETED_CUSTOMER_CLEANUP_VERIFICATION=" +
          JSON.stringify(verification)
      );
    }
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error(
    "TARGETED_CUSTOMER_CLEANUP_ERROR=" +
      JSON.stringify({ code: error.code, message: error.message })
  );
  process.exitCode = 1;
});
