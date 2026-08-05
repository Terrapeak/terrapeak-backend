import User from "../models/user.js";
import CompanyMembership from "../models/companyMembership.js";
import OrganizationMembership from "../models/organizationMembership.js";
import onboardCustomerEnvironment from "./customerOnboardingService.js";

const normalizeEnvironment = () =>
  String(process.env.APP_ENV || process.env.NODE_ENV || "")
    .trim()
    .toLowerCase();

const isStaging = () => ["staging", "stage", "preview", "test"].includes(normalizeEnvironment());
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

async function upsertPlatformOwner() {
  const email = normalizeEmail(process.env.STAGING_PLATFORM_OWNER_EMAIL);
  const password = String(process.env.STAGING_PLATFORM_OWNER_PASSWORD || "");
  if (!email || !password) {
    throw new Error("Staging Platform owner credentials are not configured.");
  }

  let user = await User.findOne({ email });
  if (!user) {
    user = new User({
      name: "Tim Harmsen",
      email,
      phone: process.env.STAGING_PLATFORM_OWNER_PHONE || "+6500000001",
      password,
      country: "SG",
      companyName: "TerraPeak Group",
      role: "admin",
      isAdmin: true,
      platformRole: "platform-owner",
      isApproved: true,
      accountStatus: "active",
    });
  } else {
    await CompanyMembership.deleteMany({ userId: user._id });
    await OrganizationMembership.deleteMany({ userId: user._id });
    user.name = user.name || "Tim Harmsen";
    user.password = password;
    user.role = "admin";
    user.isAdmin = true;
    user.platformRole = "platform-owner";
    user.isApproved = true;
    user.accountStatus = "active";
    user.mustChangePassword = false;
  }

  await user.save();
  return user;
}

async function provisionDashboardCustomer() {
  const email = normalizeEmail(process.env.STAGING_DASHBOARD_EMAIL);
  const password = String(process.env.STAGING_DASHBOARD_PASSWORD || "");
  if (!email || !password) {
    throw new Error("Staging Dashboard credentials are not configured.");
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    existingUser.password = password;
    existingUser.platformRole = "none";
    existingUser.isAdmin = false;
    existingUser.role = "user";
    existingUser.isApproved = true;
    existingUser.accountStatus = "active";
    existingUser.mustChangePassword = false;
    await existingUser.save();
  }

  return onboardCustomerEnvironment({
    owner: {
      name: "TerraPeak Group",
      email,
      phone: existingUser?.phone || process.env.STAGING_DASHBOARD_PHONE || "+6500000002",
      password,
      country: "SG",
    },
    company: {
      name: "TerraPeak Group",
      displayName: "TerraPeak Group",
      slug: "terrapeak-group-staging",
      referencePrefix: "TPG",
      reservationBusinessSlug: "terrapeak-group-staging",
      plan: "starter",
      maxUsers: 5,
    },
    organization: {
      mode: "create",
      name: "TerraPeak Group",
      slug: "terrapeak-group-staging-organization",
    },
    billing: { mode: "company" },
    installedApps: ["ai-assistant", "reservations", "content-studio"],
  });
}

export async function bootstrapStagingIdentities() {
  if (!isStaging()) return null;

  const platformOwner = await upsertPlatformOwner();
  const customerEnvironment = await provisionDashboardCustomer();

  console.log("V2 staging identities ready", {
    platformOwner: platformOwner.email,
    dashboardOwner: customerEnvironment.user.email,
    company: customerEnvironment.company.slug,
  });

  return { platformOwner, customerEnvironment };
}

export default bootstrapStagingIdentities;
