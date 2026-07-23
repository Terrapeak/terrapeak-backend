import User from "../models/user.js";
import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import ChatbotSettings from "../models/chatbotSettings.js";
import Contract from "../models/contract.js";
import { createTrialContract } from "./contractService.js";
import { provisionCompany } from "./companyProvisioningService.js";

const DEFAULT_TRIAL_DAYS = 30;
const DEFAULT_TRIAL_CREDITS = 1000;

function createTrialBilling() {
  const now = new Date();

  const trialEndDate = new Date(now);
  trialEndDate.setDate(
    trialEndDate.getDate() + DEFAULT_TRIAL_DAYS
  );

  return {
    status: "trial",
    trialEndDate,
    renewalDate: null,
    contractEndDate: null,
    creditsRemaining: DEFAULT_TRIAL_CREDITS,
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
  installedApps = null,
}) {
  if (!owner?.email) {
    throw new Error("Owner email is required.");
  }

  if (!companyInput?.name) {
    throw new Error("Company name is required.");
  }

  const companySlug =
    companyInput.slug || slugify(companyInput.name);

  const referencePrefix =
    companyInput.referencePrefix ||
    makeReferencePrefix(companyInput.name);

  if (!companySlug) {
    throw new Error("A valid company slug could not be generated.");
  }

  if (!referencePrefix) {
    throw new Error(
      "A valid company reference prefix could not be generated."
    );
  }

  /*
   * 1. Find or create the customer owner.
   */
  let user = await User.findOne({
    email: owner.email.toLowerCase().trim(),
  });

  if (!user) {
    if (!owner.password) {
      throw new Error(
        "A password is required when creating a new owner user."
      );
    }

    if (!owner.phone) {
      throw new Error(
        "A phone number is required when creating a new owner user."
      );
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
    });

    await user.save();
  } else {
    let userChanged = false;

    if (!user.isApproved) {
      user.isApproved = true;
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

  /*
   * 2. Find or create the Company.
   */
  let company = await Company.findOne({
    slug: companySlug,
  });

  if (!company) {
    company = new Company({
      name: companyInput.name,
      displayName:
        companyInput.displayName || companyInput.name,
      slug: companySlug,
      referencePrefix,
      reservationBusinessSlug:
        companyInput.reservationBusinessSlug ||
        companySlug,
      installedApps: [],
      plan: companyInput.plan || "starter",
      maxUsers: companyInput.maxUsers || 1,
      ownerUserId: user._id,
      isActive: true,
      billing: createTrialBilling(),
      });

    await company.save();
  } else {
    let companyChanged = false;

    if (!company.ownerUserId) {
      company.ownerUserId = user._id;
      companyChanged = true;
    }

    if (!company.isActive) {
      company.isActive = true;
      companyChanged = true;
    }

    if (
      !company.billing ||
      company.billing.status === "not_configured"
    ) {
      company.billing = createTrialBilling();
      companyChanged = true;
    }

    if (!company.displayName) {
      company.displayName =
        companyInput.displayName || companyInput.name;
      companyChanged = true;
    }

    if (companyChanged) {
      await company.save();
    }
  }

  /*
   * 3. Ensure the owner membership exists.
   */
  const membership =
    await CompanyMembership.findOneAndUpdate(
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
      }
    );

    /*
 * 3.5 Create the customer's first contract.
 * Every customer starts with exactly one Trial Contract.
 */
let contract = await Contract.findOne({
  companyId: company._id,
});

if (!contract) {
  contract = await createTrialContract({
    company,
    createdBy: user,
  });
}

  /*
   * 4. Install and initialize apps using the coat-rack installer.
   *
   * installApps remains the single module initialization entry point.
   */
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
    ])
  );
  company.installedApps = Array.from(
    new Set([...(company.installedApps || []), ...provisionedAppSlugs])
  );

  /*
   * 5. Validate AI Assistant linkage when installed.
   */
  let chatbotSettings = null;

  if (provisionedAppSlugs.includes("ai-assistant")) {
    chatbotSettings =
      await ChatbotSettings.findOne({ companyId: company._id });

    if (!chatbotSettings) {
      throw new Error(
        "AI Assistant installation completed without linked ChatbotSettings."
      );
    }

    if (
      !chatbotSettings.companyId ||
      chatbotSettings.companyId.toString() !==
        company._id.toString()
    ) {
      chatbotSettings.companyId = company._id;
      await chatbotSettings.save();
    }
  }

  /*
   * 6. Return one consistent onboarding result.
   */
  return {
    user,
    company,
    contract,
    membership,
    installedApps: provisionedAppSlugs,
    installResults: chatbotSettings
      ? { "ai-assistant": chatbotSettings }
      : {},
    provisioning,
    chatbotSettings,
    validation: {
      userReady: Boolean(user?._id && user.isApproved),
      companyReady: Boolean(
        company?._id && company.isActive
      ),
      membershipReady: Boolean(
        membership?._id && membership.status === "active"
      ),
      aiAssistantReady: provisionedAppSlugs.includes(
        "ai-assistant"
      )
        ? Boolean(
            chatbotSettings?._id &&
              chatbotSettings.companyId?.toString() ===
                company._id.toString()
          )
        : null,
    },
  };
}

export default onboardCustomerEnvironment;
