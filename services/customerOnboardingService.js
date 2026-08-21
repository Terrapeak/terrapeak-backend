import User from "../models/user.js";
import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import Organization from "../models/organization.js";
import OrganizationMembership from "../models/organizationMembership.js";
import ChatbotSettings from "../models/chatbotSettings.js";
import Contract from "../models/contract.js";
import { createTrialContract } from "./contractService.js";
import { provisionCompany } from "./companyProvisioningService.js";

const DEFAULT_TRIAL_DAYS = 30;
const DEFAULT_TRIAL_CREDITS = 1000;

function createTrialBilling() {
  const now = new Date();
  const trialEndDate = new Date(now);
  trialEndDate.setDate(trialEndDate.getDate() + DEFAULT_TRIAL_DAYS);

  return {
    status: "trial",
    trialEndDate,
    renewalDate: null,
    contractEndDate: null,
    creditsRemaining: DEFAULT_TRIAL_CREDITS,
    paymentStatus: "not_configured",
  };
}

function createEmptyBilling() {
  return {
    status: "not_configured",
    trialEndDate: null,
    renewalDate: null,
    contractEndDate: null,
    creditsRemaining: null,
    paymentStatus: "not_configured",
  };
}

function slugify(text = "") {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function makeReferencePrefix(companyName = "") {
  return companyName
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 5);
}

export async function onboardCustomerEnvironment({
  owner,
  company: companyInput,
  organization: organizationInput = {},
  billing: billingInput = {},
  installedApps = null,
}) {
  if (!owner?.email) {
    throw new Error("Owner email is required.");
  }

  if (!companyInput?.name) {
    throw new Error("Company name is required.");
  }

  const organizationMode = organizationInput.mode || "create";
  const billingMode = billingInput.mode || "company";

  if (!["create", "existing"].includes(organizationMode)) {
    throw new Error("Organization mode must be create or existing.");
  }

  if (!["organization", "company"].includes(billingMode)) {
    throw new Error("Billing mode must be organization or company.");
  }

  const companySlug = companyInput.slug || slugify(companyInput.name);
  const organizationSlug =
    organizationInput.slug || `${companySlug}-organization`;
  const referencePrefix =
    companyInput.referencePrefix || makeReferencePrefix(companyInput.name);

  if (!companySlug) {
    throw new Error("A valid company slug could not be generated.");
  }

  if (organizationMode === "create" && !organizationSlug) {
    throw new Error("A valid organization slug could not be generated.");
  }

  if (organizationMode === "existing" && !organizationInput.id) {
    throw new Error("An existing Organization must be selected.");
  }

  if (!referencePrefix) {
    throw new Error("A valid company reference prefix could not be generated.");
  }

  let user = await User.findOne({
    email: owner.email.toLowerCase().trim(),
  });

  if (!user) {
    if (!owner.password) {
      throw new Error("A password is required when creating a new owner user.");
    }

    if (!owner.phone) {
      throw new Error("A phone number is required when creating a new owner user.");
    }

    user = new User({
      name: owner.name,
      email: owner.email.toLowerCase().trim(),
      phone: owner.phone,
      password: owner.password,
      country: owner.country || "PH",
      companyName: companyInput.name,
      isAdmin: false,
      role: "user",
      platformRole: "none",
      isApproved: true,
      accountStatus: "active",
    });

    await user.save();
  } else {
    if (user.platformRole && user.platformRole !== "none") {
      throw new Error(
        "A Platform user cannot be assigned as a customer organization member.",
      );
    }

    let userChanged = false;

    if (!user.isApproved) {
      user.isApproved = true;
      userChanged = true;
    }

    if (user.accountStatus !== "active") {
      user.accountStatus = "active";
      userChanged = true;
    }

    if (!user.companyName) {
      user.companyName = companyInput.name;
      userChanged = true;
    }

    if (userChanged) {
      await user.save();
    }
  }

  let organization;

  if (organizationMode === "existing") {
    organization = await Organization.findOne({
      _id: organizationInput.id,
      status: { $ne: "archived" },
    });

    if (!organization) {
      throw new Error("The selected Organization could not be found.");
    }
  } else {
    organization = await Organization.findOne({ slug: organizationSlug });

    if (!organization) {
      organization = new Organization({
        name: organizationInput.name || companyInput.name,
        slug: organizationSlug,
        status: "active",
        billingMode,
        plan: companyInput.plan || "starter",
        billing:
          billingMode === "organization"
            ? {
                ...createTrialBilling(),
                maxUsers: companyInput.maxUsers || 1,
                maxCompanies: null,
              }
            : {
                ...createEmptyBilling(),
                maxUsers: null,
                maxCompanies: null,
              },
        createdByUserId: user._id,
        metadata: {
          source: "customer-onboarding",
        },
      });
      await organization.save();
    } else if (organization.status === "archived") {
      throw new Error("An archived Organization cannot be used for onboarding.");
    }
  }

  if (billingMode === "organization") {
    organization.billingMode = "organization";
    organization.plan = companyInput.plan || organization.plan || "starter";

    if (!organization.billing || organization.billing.status === "not_configured") {
      organization.billing = {
        ...createTrialBilling(),
        maxUsers: organization.billing?.maxUsers ?? companyInput.maxUsers ?? 1,
        maxCompanies: organization.billing?.maxCompanies ?? null,
      };
    }

    await organization.save();
  } else if (organizationMode === "create") {
    organization.billingMode = "company";
    await organization.save();
  }

  const organizationMembershipRole =
    organizationMode === "create" ? "owner" : "member";
  let organizationMembership = await OrganizationMembership.findOne({
    organizationId: organization._id,
    userId: user._id,
  });

  if (!organizationMembership) {
    organizationMembership = new OrganizationMembership({
      organizationId: organization._id,
      userId: user._id,
      role: organizationMembershipRole,
      status: "active",
    });
  } else {
    if (organizationMode === "create") {
      organizationMembership.role = "owner";
    }
    organizationMembership.status = "active";
  }
  await organizationMembership.save();

  let company = await Company.findOne({ slug: companySlug });
  const companyBilling =
    billingMode === "company" ? createTrialBilling() : createEmptyBilling();

  if (!company) {
    company = new Company({
      name: companyInput.name,
      displayName: companyInput.displayName || companyInput.name,
      slug: companySlug,
      referencePrefix,
      reservationBusinessSlug:
        companyInput.reservationBusinessSlug || companySlug,
      reservationTemplate: companyInput.reservationTemplate || "general",
      installedApps: [],
      plan: companyInput.plan || organization.plan || "starter",
      billingSource: billingMode,
      maxUsers: companyInput.maxUsers || 1,
      ownerUserId: user._id,
      organizationId: organization._id,
      isActive: true,
      isPlatformWorkspace: false,
      billing: companyBilling,
    });

    await company.save();
  } else {
    let companyChanged = false;

    if (!company.ownerUserId) {
      company.ownerUserId = user._id;
      companyChanged = true;
    }

    if (!company.organizationId) {
      company.organizationId = organization._id;
      companyChanged = true;
    } else if (
      String(company.organizationId) !== String(organization._id)
    ) {
      throw new Error(
        "The existing company already belongs to a different Organization.",
      );
    }

    if (company.isPlatformWorkspace) {
      throw new Error(
        "A Platform workspace cannot be used for customer onboarding.",
      );
    }

    if (!company.isActive) {
      company.isActive = true;
      companyChanged = true;
    }

    if (company.billingSource !== billingMode) {
      company.billingSource = billingMode;
      companyChanged = true;
    }

    if (
      billingMode === "company" &&
      (!company.billing || company.billing.status === "not_configured")
    ) {
      company.billing = createTrialBilling();
      companyChanged = true;
    }

    if (billingMode === "organization" && company.billing?.status !== "not_configured") {
      company.billing = createEmptyBilling();
      companyChanged = true;
    }

    if (!company.displayName) {
      company.displayName = companyInput.displayName || companyInput.name;
      companyChanged = true;
    }

    if (companyChanged) {
      await company.save();
    }
  }

  const membership = await CompanyMembership.findOneAndUpdate(
    {
      companyId: company._id,
      userId: user._id,
    },
    {
      $set: {
        companyId: company._id,
        userId: user._id,
        role: "owner",
        status: "active",
        removedAt: null,
        removedByUserId: null,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    },
  );

  let contract = await Contract.findOne({ companyId: company._id });

  if (billingMode === "company" && !contract) {
    contract = await createTrialContract({
      company,
      createdBy: user,
    });
  }

  const provisioning = await provisionCompany({
    companyId: company._id,
    ownerUserId: user._id,
    mode: "customer",
    requestedAppSlugs: installedApps,
  });
  const provisionedAppSlugs = Array.from(
    new Set([
      ...provisioning.installedApps,
      ...provisioning.alreadyInstalledApps,
    ]),
  );
  company.installedApps = Array.from(
    new Set([...(company.installedApps || []), ...provisionedAppSlugs]),
  );
  await company.save();

  let chatbotSettings = null;

  if (provisionedAppSlugs.includes("ai-assistant")) {
    chatbotSettings = await ChatbotSettings.findOne({ companyId: company._id });

    if (!chatbotSettings) {
      throw new Error(
        "AI Assistant installation completed without linked ChatbotSettings.",
      );
    }

    if (
      !chatbotSettings.companyId ||
      chatbotSettings.companyId.toString() !== company._id.toString()
    ) {
      chatbotSettings.companyId = company._id;
      await chatbotSettings.save();
    }
  }

  return {
    user,
    organization,
    organizationMembership,
    organizationMode,
    billingMode,
    company,
    contract,
    membership,
    installedApps: provisionedAppSlugs,
    installResults: chatbotSettings ? { "ai-assistant": chatbotSettings } : {},
    provisioning,
    chatbotSettings,
    validation: {
      userReady: Boolean(
        user?._id &&
          user.isApproved &&
          user.accountStatus === "active" &&
          user.platformRole === "none",
      ),
      organizationReady: Boolean(
        organization?._id && organization.status === "active",
      ),
      organizationMembershipReady: Boolean(
        organizationMembership?._id &&
          organizationMembership.status === "active",
      ),
      billingReady:
        billingMode === "organization"
          ? ["trial", "active", "manual"].includes(
              organization.billing?.status,
            )
          : ["trial", "active", "manual"].includes(company.billing?.status),
      companyReady: Boolean(
        company?._id &&
          company.isActive &&
          !company.isPlatformWorkspace &&
          company.billingSource === billingMode &&
          String(company.organizationId) === String(organization._id),
      ),
      membershipReady: Boolean(
        membership?._id && membership.status === "active",
      ),
      aiAssistantReady: provisionedAppSlugs.includes("ai-assistant")
        ? Boolean(
            chatbotSettings?._id &&
              chatbotSettings.companyId?.toString() === company._id.toString(),
          )
        : null,
    },
  };
}

export default onboardCustomerEnvironment;
