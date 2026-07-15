import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import User from "../models/user.js";
import CompanyMembership from "../models/companyMembership.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import { runPlatformAttentionScan } from "../services/platformAttentionScanService.js";

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
    },
    needsAttention,
    morningBrief: {
      title: "Good morning",
      message: hasAttentionItems
        ? `${needsAttention.length} customer workspace${
            needsAttention.length === 1 ? " requires" : "s require"
          } attention.`
        : "Platform is operational. No critical customer issues detected.",
      recommendations: hasAttentionItems
        ? ["Review the customer workspaces listed under Needs Attention."]
        : ["Continue monitoring customer onboarding and platform activity."],
    },
  });
});
