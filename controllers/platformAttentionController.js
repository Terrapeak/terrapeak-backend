import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import { runPlatformAttentionScan } from "../services/platformAttentionScanService.js";
import { getPlatformBillingHealth } from "../services/platformBillingHealthService.js";

const ACTIVITY_LIMIT = 30;
const CUSTOMER_COMPANY_FILTER = { isPlatformWorkspace: { $ne: true } };

const formatAppName = (slug = "") =>
  slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const getPlatformRecentActivity = async (customerCompanyIds) => {
  const [recentCompanies, recentInstallations, companiesWithActivity] =
    await Promise.all([
      Company.find(CUSTOMER_COMPANY_FILTER)
        .select("name displayName createdAt")
        .sort({ createdAt: -1 })
        .limit(12)
        .lean(),
      CompanyAppInstallation.find({ companyId: { $in: customerCompanyIds } })
        .select("companyId appSlug enabled status installedAt createdAt updatedAt")
        .populate("companyId", "name displayName")
        .sort({ updatedAt: -1 })
        .limit(20)
        .lean(),
      Company.find({
        ...CUSTOMER_COMPANY_FILTER,
        "activityEvents.0": { $exists: true },
      })
        .select("name displayName activityEvents")
        .sort({ updatedAt: -1 })
        .limit(15)
        .lean(),
    ]);

  const activities = [];

  recentCompanies.forEach((company) => {
    activities.push({
      id: `company-${company._id}`,
      type: "Onboarding",
      level: "important",
      title: "New customer onboarded",
      message: `${company.displayName || company.name} was added to the platform.`,
      companyId: company._id,
      occurredAt: company.createdAt,
    });
  });

  recentInstallations.forEach((installation) => {
    const company = installation.companyId;
    if (!company) return;

    const appName = formatAppName(installation.appSlug);
    const isDisabled =
      !installation.enabled || installation.status === "disabled";

    activities.push({
      id: `installation-${installation._id}`,
      type: "Apps",
      level: isDisabled ? "normal" : "important",
      title: `${appName} ${isDisabled ? "disabled" : "installed"}`,
      message: `${appName} is ${isDisabled ? "disabled" : "active"} for ${
        company.displayName || company.name
      }.`,
      companyId: company._id,
      occurredAt:
        installation.updatedAt ||
        installation.installedAt ||
        installation.createdAt,
    });
  });

  companiesWithActivity.forEach((company) => {
    (company.activityEvents || []).forEach((event) => {
      activities.push({
        id: `company-event-${event._id}`,
        type: "Apps",
        level: ["installed", "enabled"].includes(event.eventType)
          ? "important"
          : "normal",
        title: event.title || "Application updated",
        message: `${event.appName || formatAppName(event.appSlug)} was ${
          event.eventType || "updated"
        } for ${company.displayName || company.name}.`,
        companyId: company._id,
        occurredAt: event.createdAt,
      });
    });
  });

  const uniqueActivities = new Map();

  activities
    .filter((activity) => activity.occurredAt)
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
    .forEach((activity) => {
      const key = `${activity.type}-${activity.title}-${activity.companyId}-${new Date(
        activity.occurredAt,
      ).toISOString()}`;

      if (!uniqueActivities.has(key)) {
        uniqueActivities.set(key, activity);
      }
    });

  return Array.from(uniqueActivities.values()).slice(0, ACTIVITY_LIMIT);
};

const mapBillingActionToAttentionItem = (action, index) => ({
  id: `billing-${action.type}-${action.organizationId || "none"}-${
    action.companyId || index
  }`,
  source: "billing",
  severity: action.severity,
  type: action.type,
  title: action.title,
  message: action.description,
  companyId: action.companyId,
  companyName: action.companyName,
  organizationId: action.organizationId,
  organizationName: action.organizationName,
});

export const getPlatformDashboardSummary = asyncHandler(async (req, res) => {
  const customerCompanies = await Company.find(CUSTOMER_COMPANY_FILTER)
    .select("_id isActive")
    .lean();
  const customerCompanyIds = customerCompanies.map((company) => company._id);

  const [
    customerMemberships,
    totalInstalledApps,
    aiAssistantInstalls,
    reservationInstalls,
    attentionScan,
    billingHealth,
    recentActivity,
  ] = await Promise.all([
    CompanyMembership.find({ companyId: { $in: customerCompanyIds } })
      .select("userId status")
      .lean(),
    CompanyAppInstallation.countDocuments({
      companyId: { $in: customerCompanyIds },
      enabled: true,
    }),
    CompanyAppInstallation.countDocuments({
      companyId: { $in: customerCompanyIds },
      appSlug: "ai-assistant",
      enabled: true,
    }),
    CompanyAppInstallation.countDocuments({
      companyId: { $in: customerCompanyIds },
      appSlug: "reservations",
      enabled: true,
    }),
    runPlatformAttentionScan(),
    getPlatformBillingHealth(),
    getPlatformRecentActivity(customerCompanyIds),
  ]);

  const activeMemberships = customerMemberships.filter(
    (membership) => membership.status === "active",
  );
  const totalCustomerUsers = new Set(
    customerMemberships
      .map((membership) => membership.userId?.toString())
      .filter(Boolean),
  ).size;

  const billingAttention = billingHealth.actions.map(
    mapBillingActionToAttentionItem,
  );
  const needsAttention = [
    ...billingAttention,
    ...attentionScan.needsAttention,
  ];
  const hasAttentionItems = needsAttention.length > 0;

  res.json({
    success: true,
    summary: {
      platformStatus:
        billingHealth.summary.criticalBillingCount > 0
          ? "attention required"
          : "operational",
      totalCompanies: customerCompanies.length,
      activeCompanies: customerCompanies.filter((company) => company.isActive)
        .length,
      totalUsers: totalCustomerUsers,
      totalActiveMemberships: activeMemberships.length,
      totalInstalledApps,
      aiAssistantInstalls,
      reservationInstalls,
      needsAttentionCount: needsAttention.length,
      billingAttentionCount: billingHealth.summary.billingAttentionCount,
      criticalBillingCount: billingHealth.summary.criticalBillingCount,
      healthyBillingCount: billingHealth.summary.healthyBillingCount,
      inheritedBillingCount: billingHealth.summary.inheritedBillingCount,
      organizationBillingCount:
        billingHealth.summary.organizationBillingCount,
      scannedCompanies: attentionScan.scannedCompanies,
      scannedAt: attentionScan.scannedAt,
      activityRefreshedAt: new Date(),
    },
    customerHealth: attentionScan.customerHealth,
    billingHealth,
    needsAttention,
    recentActivity,
    morningBrief: {
      title: "Good morning",
      message: hasAttentionItems
        ? `${needsAttention.length} platform action${
            needsAttention.length === 1 ? " requires" : "s require"
          } attention.`
        : "Platform is operational. No critical customer or billing issues detected.",
      recommendations: hasAttentionItems
        ? [
            billingAttention.length > 0
              ? "Review billing and Organization structure issues first."
              : "Review the customer workspaces listed under Customer Health.",
          ]
        : ["Continue monitoring customer onboarding and platform activity."],
    },
  });
});

export const runPlatformAttentionScanNow = asyncHandler(async (req, res) => {
  const [attentionScan, billingHealth] = await Promise.all([
    runPlatformAttentionScan(),
    getPlatformBillingHealth(),
  ]);
  const billingAttention = billingHealth.actions.map(
    mapBillingActionToAttentionItem,
  );

  res.json({
    success: true,
    scannedAt: attentionScan.scannedAt,
    scannedCompanies: attentionScan.scannedCompanies,
    needsAttentionCount:
      attentionScan.needsAttention.length + billingAttention.length,
    customerHealth: attentionScan.customerHealth,
    billingHealth,
    needsAttention: [...billingAttention, ...attentionScan.needsAttention],
  });
});
