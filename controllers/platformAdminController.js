import Contract from "../models/contract.js";
import asyncHandler from "express-async-handler";
import Company from "../models/company.js";
import User from "../models/user.js";
import CompanyMembership from "../models/companyMembership.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import App from "../models/app.js";
import ChatbotSettings from "../models/chatbotSettings.js";
import Session from "../models/sessionModel.js";
import { canEnableCompanyApp } from "../services/companyAppAccessService.js";
import installApps, { hasAppInstaller } from "../installers/installApps.js";

const ACTIVITY_LIMIT = 50;

const APP_ACTIVITY_ACTION_LABELS = {
  installed: "installed",
  uninstalled: "uninstalled",
  enabled: "enabled",
  disabled: "disabled",
  updated: "updated",
};

const buildCompanyAppActivity = ({ eventType, app, actor, metadata = {} }) => {
  const appName = app.name || app.slug;

  return {
    eventType,
    title: `${appName} ${APP_ACTIVITY_ACTION_LABELS[eventType] || "updated"}`,
    appSlug: app.slug,
    appName,
    actorUserId: actor?._id || null,
    actorName: actor?.name || "",
    actorEmail: actor?.email || "",
    createdAt: new Date(),
    metadata,
  };
};

const appendCompanyActivity = async ({ companyId, event }) => {
  await Company.updateOne(
    { _id: companyId },
    {
      $push: {
        activityEvents: {
          $each: [event],
          $position: 0,
          $slice: ACTIVITY_LIMIT,
        },
      },
    }
  );
};

const getCompanyActivityEvents = (company) =>
  (company.activityEvents || [])
    .map((event) => ({
      _id: event._id,
      eventType: event.eventType,
      title: event.title,
      appSlug: event.appSlug,
      appName: event.appName,
      actorName: event.actorName,
      actorEmail: event.actorEmail,
      createdAt: event.createdAt,
      metadata: event.metadata || {},
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, ACTIVITY_LIMIT);

const getSafeAIUsageSummary = () => ({
  messagesToday: 0,
  messagesThisMonth: 0,
  conversations: 0,
  creditsRemaining: null,
  lastActivity: null,
  status: "not_configured",
});

const countUserMessagesSince = async ({ chatbotIds, since }) => {
  const [result] = await Session.aggregate([
    {
      $match: {
        chatbotId: { $in: chatbotIds },
        isPreview: { $ne: true },
      },
    },
    { $unwind: "$chatLogs" },
    {
      $match: {
        "chatLogs.role": "user",
        "chatLogs.timestamp": { $gte: since },
      },
    },
    { $count: "count" },
  ]);

  return result?.count || 0;
};

const getCompanyAIUsageSummary = async (companyId) => {
  const chatbots = await ChatbotSettings.find({ companyId }).select("_id");
  const chatbotIds = chatbots.map((chatbot) => chatbot._id);

  if (!chatbotIds.length) {
    return getSafeAIUsageSummary();
  }

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [messagesToday, messagesThisMonth, conversations, latestSession] =
    await Promise.all([
      countUserMessagesSince({ chatbotIds, since: startOfToday }),
      countUserMessagesSince({ chatbotIds, since: startOfMonth }),
      Session.countDocuments({
        chatbotId: { $in: chatbotIds },
        isPreview: { $ne: true },
      }),
      Session.findOne({
        chatbotId: { $in: chatbotIds },
        isPreview: { $ne: true },
      })
        .sort({ updatedAt: -1 })
        .select("updatedAt")
        .lean(),
    ]);

  return {
    messagesToday,
    messagesThisMonth,
    conversations,
    creditsRemaining: null,
    lastActivity: latestSession?.updatedAt || null,
    status: "tracking",
  };
};

const getCompanyBillingSummary = (company) => {
  const billing = company.billing || {};

  return {
  plan: company.plan || "starter",
  billingStatus:
    billing.status || "not_configured",
  trialEndDate:
    billing.trialEndDate || null,
  renewalDate:
    billing.renewalDate || null,
  contractEndDate:
    billing.contractEndDate || null,
  creditsRemaining:
    billing.creditsRemaining ?? null,
  paymentStatus:
    billing.paymentStatus || "not_configured",
};
};

/* ---------- INSERT BELOW THIS LINE ---------- */

const getCompanyHealthSummary = ({
  company,
  apps,
  aiUsage,
  billingSummary,
  activeUsers,
}) => {
  const installedAppsCount =
    apps?.filter((app) => app.enabled).length || 0;

  let score = 0;
  const strengths = [];
  const attention = [];

  if (company.isActive) {
    score += 10;
    strengths.push("Company is active");
  }

  const aiAssistant = apps?.find(
    (app) => app.appSlug === "ai-assistant"
  );

  if (aiAssistant) {
    score += 15;
    strengths.push("AI Assistant installed");

    if (aiAssistant.enabled) {
      score += 15;
      strengths.push("AI Assistant enabled");
    }
  }

  if ((aiUsage?.conversations || 0) > 0) {
    score += 20;
    strengths.push("Recent AI activity");
  }

  const healthyBillingStatuses = [
  "trial",
  "active",
  "manual",
];

if (
  healthyBillingStatuses.includes(
    billingSummary?.billingStatus
  )
) {
  score += 20;

  if (billingSummary.billingStatus === "trial") {
    strengths.push("Trial billing active");
  } else if (
    billingSummary.billingStatus === "manual"
  ) {
    strengths.push("Manual billing approved");
  } else {
    strengths.push("Billing active");
  }
}

  if (activeUsers > 0) {
    score += 10;
    strengths.push("Active users");
  }

  if (installedAppsCount > 0) {
    score += 10;
    strengths.push("Installed apps");
  }

  if (
  !billingSummary ||
  !healthyBillingStatuses.includes(
    billingSummary.billingStatus
  )
) {
  attention.push(
    "Billing requires attention"
  );
}

  if ((aiUsage?.conversations || 0) === 0) {
    attention.push("No AI conversations yet");
  }

  if (activeUsers === 0) {
    attention.push("No active users");
  }

  if (installedAppsCount === 0) {
    attention.push("No installed apps");
  }

  let status = "Critical";

  if (score >= 90) {
    status = "Excellent";
  } else if (score >= 70) {
    status = "Healthy";
  } else if (score >= 40) {
    status = "Needs Attention";
  }

  return {
    score,
    status,
    strengths,
    attention,
  };
};

export const getPlatformDashboardSummary = asyncHandler(async (req, res) => {
  const [
    totalCompanies,
    totalUsers,
    totalActiveMemberships,
    totalInstalledApps,
    activeCompanies,
    aiAssistantInstalls,
    reservationInstalls,
  ] = await Promise.all([
    Company.countDocuments(),
    User.countDocuments(),
    CompanyMembership.countDocuments({ status: "active" }),
    CompanyAppInstallation.countDocuments({ enabled: true }),

    Company.countDocuments({ isActive: true }),

    CompanyAppInstallation.countDocuments({
      appSlug: "ai-assistant",
      enabled: true,
    }),

    CompanyAppInstallation.countDocuments({
      appSlug: "reservations",
      enabled: true,
    }),
  ]);

  const needsAttention = [];

  res.json({
    success: true,
    summary: {
      platformStatus: "operational",
      totalCompanies,
      activeCompanies,
      totalUsers,
      totalActiveMemberships,
      totalInstalledApps,
      aiAssistantInstalls,
      reservationInstalls,
      needsAttentionCount: needsAttention.length,
    },
    needsAttention,
    morningBrief: {
      title: "Good morning",
      message:
        "Platform is operational. No critical customer issues detected yet.",
      recommendations: [
        "Review new customer onboarding progress.",
        "Check reservation customers before the demo.",
          ],
    },
  });
});
export const searchPlatformCompanies = asyncHandler(async (req, res) => {
  const query = (req.query.q || "").trim();

  if (!query) {
    return res.json({
      success: true,
      companies: [],
    });
  }

  const companyQuery = {
    $or: [
      { name: { $regex: query, $options: "i" } },
      { displayName: { $regex: query, $options: "i" } },
      { slug: { $regex: query, $options: "i" } },
    ],
  };

  const userQuery = {
    $or: [
      { name: { $regex: query, $options: "i" } },
      { email: { $regex: query, $options: "i" } },
      { companyName: { $regex: query, $options: "i" } },
    ],
  };

  const [companies, matchingUsers] = await Promise.all([
    Company.find(companyQuery)
    .select("name displayName slug country installedApps createdAt")
    .limit(10)
      .sort({ createdAt: -1 }),
    User.find(userQuery).select("_id").limit(20),
  ]);

  let membershipCompanies = [];

  if (matchingUsers.length) {
    const memberships = await CompanyMembership.find({
      userId: { $in: matchingUsers.map((user) => user._id) },
      status: "active",
    })
      .populate({
        path: "companyId",
        select: "name displayName slug country installedApps createdAt",
      })
      .limit(20);

    membershipCompanies = memberships
      .map((membership) => membership.companyId)
      .filter(Boolean);
  }

  const companyMap = new Map();

  [...companies, ...membershipCompanies].forEach((company) => {
    companyMap.set(company._id.toString(), company);
  });

  res.json({
    success: true,
    companies: Array.from(companyMap.values()).slice(0, 10),
  });
});

export const getPlatformCompanyDetail = asyncHandler(async (req, res) => {
  const { companyId } = req.params;

  const company = await Company.findById(companyId);

  if (!company) {
    return res.status(404).json({
      success: false,
      message: "Company not found.",
    });
  }

  const memberships = await CompanyMembership.find({
    companyId: company._id,
    status: "active",
  }).populate("userId", "name email phone role isAdmin platformRole");

  const installations = await CompanyAppInstallation.find({
    companyId: company._id,
  });

  const availableApps = await App.find({
    isVisible: true,
  }).sort({ sortOrder: 1 });

  const aiUsage =
  await getCompanyAIUsageSummary(company._id);

const billingSummary =
  getCompanyBillingSummary(company);

  const contract = await Contract.findOne({
  companyId: company._id,
  }).lean();


const aiUsageWithBilling = {
  ...aiUsage,
  creditsRemaining:
    billingSummary.creditsRemaining,
};

const healthSummary = getCompanyHealthSummary({
  company,
  apps: installations,
  aiUsage: aiUsageWithBilling,
  billingSummary,
  activeUsers: memberships.length,
});

  res.json({
  success: true,
  company,
  contract,
    users: memberships.map((membership) => ({
      membershipId: membership._id,
      role: membership.role,
      user: membership.userId,
    })),
    apps: installations,
    availableApps,
    activityEvents: getCompanyActivityEvents(company),
    billingSummary,
    aiUsage: aiUsageWithBilling,
healthSummary,
  });
});

export const toggleCompanyApp = asyncHandler(async (req, res) => {
  const { companyId, appId } = req.params;

  const company = await Company.findById(companyId).select(
  "_id slug plan billing installedApps displayName reservationBusinessSlug referencePrefix ownerUserId"
);
  if (!company) {
    return res.status(404).json({
      success: false,
      message: "Company not found.",
    });
  }

  const app = await App.findById(appId);

  if (!app) {
    return res.status(404).json({
      success: false,
      message: "App not found.",
    });
  }

  let eventType = "installed";

let installation =
  await CompanyAppInstallation.findOne({
    companyId,
    appSlug: app.slug,
  });

const isBeingEnabled =
  !installation || !installation.enabled;

if (isBeingEnabled) {
  const access = canEnableCompanyApp({
    company,
    app,
  });

  if (!access.allowed) {
    return res.status(409).json({
      success: false,
      code: "APP_BILLING_RESTRICTION",
      message: access.reason,
      billingStatus:
        company.billing?.status ||
        "not_configured",
      plan: company.plan || "starter",
      minimumPlan:
        app.minimumPlan || null,
    });
  }
}

if (isBeingEnabled && hasAppInstaller(app.slug)) {
    const wasPreviouslyInstalled = Boolean(installation);

    await installApps({
      company,
      user: { _id: company.ownerUserId },
      installedBy: req.platformUser,
      installedApps: [app.slug],
    });

    installation = await CompanyAppInstallation.findOne({
      companyId,
      appSlug: app.slug,
    });
    eventType = wasPreviouslyInstalled ? "enabled" : "installed";
  } else if (!installation) {
    installation = await CompanyAppInstallation.create({
      companyId,
      appSlug: app.slug,
      enabled: true,
      status: "active",
      installedBy: req.userId,
    });
  } else {
    installation.enabled = !installation.enabled;
    installation.status = installation.enabled ? "active" : "disabled";
    await installation.save();
    eventType = installation.enabled ? "enabled" : "disabled";
  }

  if (
    isBeingEnabled &&
    installation?.enabled &&
    !(company.installedApps || []).includes(app.slug)
  ) {
    company.installedApps = [...(company.installedApps || []), app.slug];
    await company.save();
  }

  await appendCompanyActivity({
    companyId: company._id,
    event: buildCompanyAppActivity({
      eventType,
      app,
      actor: req.platformUser,
    }),
  });

  res.json({
    success: true,
    installation,
  });
});
export const getPlatformApps = asyncHandler(async (req, res) => {
  const apps = await App.find({})
    .sort({ sortOrder: 1, name: 1 });

  res.json({
    success: true,
    apps,
  });
});

export const updatePlatformApp = asyncHandler(async (req, res) => {
  const { appId } = req.params;

  const allowedFields = [
    "name",
    "description",
    "category",
    "isCore",
    "standalone",
    "requiresAIAssistant",
    "launchUrl",
    "isVisible",
    "isComingSoon",
    "allowInstall",
    "minimumPlan",
    "dependencies",
    "icon",
    "sortOrder",
  ];

  const updates = {};

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  const app = await App.findByIdAndUpdate(
    appId,
    updates,
    { new: true, runValidators: true }
  );

  if (!app) {
    return res.status(404).json({
      success: false,
      message: "App not found.",
    });
  }

  res.json({
    success: true,
    app,
  });
});
