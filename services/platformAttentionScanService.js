import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import ChatbotSettings from "../models/chatbotSettings.js";
import Session from "../models/sessionModel.js";

const HEALTHY_BILLING_STATUSES = new Set(["trial", "active", "manual"]);

const getHealthStatus = (score) => {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Needs Follow-up";
  if (score >= 40) return "Needs Attention";
  return "Critical";
};

const getMissingCompanyData = ({ company, ownerMembership }) => {
  const missing = [];

  if (!company.country) missing.push("Country");
  if (!company.address) missing.push("Address");
  if (!company.email) missing.push("Company email");
  if (!company.phone) missing.push("Company phone");
  if (!company.website) missing.push("Website");

  const owner = ownerMembership?.userId;
  if (ownerMembership && !owner?.name) missing.push("Owner name");
  if (ownerMembership && !owner?.email) missing.push("Owner email");
  if (ownerMembership && !owner?.phone) missing.push("Owner phone");

  return missing;
};

const calculateCompanyHealth = ({
  company,
  installations,
  conversations,
  activeUsers,
  ownerMembership,
}) => {
  const enabledAppsCount = installations.filter((app) => app.enabled).length;
  const aiAssistant = installations.find(
    (app) => app.appSlug === "ai-assistant"
  );

  let score = 0;
  const attention = [];

  if (company.isActive) score += 10;

  if (aiAssistant) {
    score += 15;
    if (aiAssistant.enabled) score += 15;
  }

  if (conversations > 0) score += 20;

  if (HEALTHY_BILLING_STATUSES.has(company.billing?.status)) {
    score += 20;
  }

  if (activeUsers > 0) score += 10;
  if (enabledAppsCount > 0) score += 10;

  if (!HEALTHY_BILLING_STATUSES.has(company.billing?.status)) {
    attention.push("Billing requires attention");
  }

  if (conversations === 0) {
    attention.push("No AI conversations yet");
  }

  if (activeUsers === 0) {
    attention.push("No active users");
  }

  if (enabledAppsCount === 0) {
    attention.push("No installed apps");
  }

  if (!ownerMembership) {
    attention.push("No active owner assigned");
    score = Math.min(score, 39);
  } else {
    const missingCompanyData = getMissingCompanyData({ company, ownerMembership });

    if (missingCompanyData.length > 0) {
      attention.push(`Missing company data: ${missingCompanyData.join(", ")}`);

      // Incomplete customer records require action but should not become critical
      // unless another core health issue already places them there.
      if (score >= 60) score = 59;
    }
  }

  return {
    score,
    status: getHealthStatus(score),
    attention,
  };
};

const scanCompany = async (company) => {
  const [installations, activeUsers, ownerMembership, chatbots] = await Promise.all([
    CompanyAppInstallation.find({ companyId: company._id })
      .select("appSlug enabled")
      .lean(),
    CompanyMembership.countDocuments({
      companyId: company._id,
      isActive: true,
    }),
    CompanyMembership.findOne({
      companyId: company._id,
      isActive: true,
      role: "owner",
    })
      .populate("userId", "name email phone")
      .lean(),
    ChatbotSettings.find({ companyId: company._id }).select("_id").lean(),
  ]);

  const chatbotIds = chatbots.map((chatbot) => chatbot._id);
  const conversations = chatbotIds.length
    ? await Session.countDocuments({
        chatbotId: { $in: chatbotIds },
        isPreview: { $ne: true },
      })
    : 0;

  const health = calculateCompanyHealth({
    company,
    installations,
    conversations,
    activeUsers,
    ownerMembership,
  });

  return {
    companyId: company._id,
    companyName: company.displayName || company.name,
    slug: company.slug,
    ...health,
  };
};

export const runPlatformAttentionScan = async () => {
  const companies = await Company.find({ isActive: true })
    .select(
      "name displayName slug isActive billing country address website email phone"
    )
    .lean();

  const results = await Promise.all(companies.map(scanCompany));

  const customerHealth = results
    .sort((a, b) => a.score - b.score)
    .map((result) => ({
      companyId: result.companyId,
      companyName: result.companyName,
      title: `${result.companyName} — ${result.status} (${result.score}%)`,
      message:
        result.attention.join(" · ") ||
        "Customer health checks are currently clear.",
      score: result.score,
      status: result.status,
      reasons: result.attention,
    }));

  const needsAttention = customerHealth.filter((result) => result.score < 60);

  return {
    scannedAt: new Date(),
    scannedCompanies: customerHealth.length,
    needsAttentionCount: needsAttention.length,
    customerHealth,
    needsAttention,
  };
};
