import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import ChatbotSettings from "../models/chatbotSettings.js";
import Session from "../models/sessionModel.js";

const HEALTHY_BILLING_STATUSES = new Set(["trial", "active", "manual"]);

const calculateCompanyHealth = ({
  company,
  installations,
  conversations,
  activeUsers,
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
    attention,
  };
};

const scanCompany = async (company) => {
  const [installations, activeUsers, chatbots] = await Promise.all([
    CompanyAppInstallation.find({ companyId: company._id })
      .select("appSlug enabled")
      .lean(),
    CompanyMembership.countDocuments({
      companyId: company._id,
      isActive: true,
    }),
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
    .select("name displayName slug isActive billing")
    .lean();

  const results = await Promise.all(companies.map(scanCompany));

  const needsAttention = results
    .filter((result) =>
      ["Critical", "Needs Attention"].includes(result.status)
    )
    .sort((a, b) => a.score - b.score)
    .map((result) => ({
      companyId: result.companyId,
      title: `${result.companyName} — ${result.status} (${result.score}%)`,
      message:
        result.attention.join(" · ") ||
        "Customer health requires review.",
      score: result.score,
      status: result.status,
      reasons: result.attention,
    }));

  return {
    scannedAt: new Date(),
    scannedCompanies: results.length,
    needsAttentionCount: needsAttention.length,
    needsAttention,
  };
};
