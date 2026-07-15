import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import User from "../models/user.js";
import CompanyMembership from "../models/companyMembership.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import { runPlatformAttentionScan } from "../services/platformAttentionScanService.js";

const ACTIVITY_LIMIT = 30;

const formatAppName = (slug = "") =>
  slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const getPlatformRecentActivity = async () => {
  const [recentCompanies, recentInstallations, companiesWithActivity] =
    await Promise.all([
      Company.find({})
        .select("name displayName createdAt")
        .sort({ createdAt: -1 })
        .limit(12)
        .lean(),
      CompanyAppInstallation.find({})
        .select("companyId appSlug enabled status installedAt createdAt updatedAt")
        .populate("companyId", "name displayName")
        .sort({ updatedAt: -1 })
        .limit(20)
        .lean(),
      Company.find({ "activityEvents.0": { $exists: true } })
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
    const isDisabled = !installation.enabled || installation.status === "disabled";

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
        installation.updatedAt || installation.installedAt || installation.createdAt,
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
        activity.occurredAt
      ).toISOString()}`;

      if (!uniqueActivities.has(key)) {
        uniqueActivities.set(key, activity);
      }
    });

  return Array.from(uniqueActivities.values()).slice(0, ACTIVITY_LIMIT);
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
    attentionScan,
    recentActivity,
  ] = await Promise.all([
    Company.countDocuments(),
    User.countDocuments(),
    CompanyMembership.countDocuments({ isActive: true }),
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
    runPlatformAttentionScan(),
    getPlatformRecentActivity(),
  ]);

  const needsAttention = attentionScan.needsAttention;
  const hasAttentionItems = needsAttention.length > 0;

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
      scannedCompanies: attentionScan.scannedCompanies,
      scannedAt: attentionScan.scannedAt,
      activityRefreshedAt: new Date(),
    },
    customerHealth: attentionScan.customerHealth,
    needsAttention,
    recentActivity,
    morningBrief: {
      title: "Good morning",
      message: hasAttentionItems
        ? `${needsAttention.length} customer workspace${
            needsAttention.length === 1 ? " requires" : "s require"
          } attention.`
        : "Platform is operational. No critical customer issues detected.",
      recommendations: hasAttentionItems
        ? ["Review the customer workspaces listed under Customer Health."]
        : ["Continue monitoring customer onboarding and platform activity."],
    },
  });
});

export const runPlatformAttentionScanNow = asyncHandler(async (req, res) => {
  const attentionScan = await runPlatformAttentionScan();

  res.json({
    success: true,
    scannedAt: attentionScan.scannedAt,
    scannedCompanies: attentionScan.scannedCompanies,
    needsAttentionCount: attentionScan.needsAttentionCount,
    customerHealth: attentionScan.customerHealth,
    needsAttention: attentionScan.needsAttention,
  });
});
