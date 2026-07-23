import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import CompanyMembership from "../models/companyMembership.js";

const ACTION_WORDS = /\b(change|update|edit|add|remove|delete|disable|enable|resend|reset|cancel|upgrade|downgrade|replace|modify|invite|create)\b/i;
const BILLING_WORDS = /\b(plan|billing|subscription|renewal|contract|trial|payment|credits?|allowance|usage)\b/i;
const COMPANY_WORDS = /\b(company|address|website|phone|country|contact details?|company email|company name)\b/i;
const USER_WORDS = /\b(users?|members?|invitation|invite status|user status|seats?)\b/i;
const APP_WORDS = /\b(apps?|applications?|channels?|installed|enabled|available|whatsapp|facebook|assistant)\b/i;

const fmtDate = (value) => value
  ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value))
  : "not configured";
const label = (value) => String(value || "not configured").replaceAll("_", " ");

const billingReply = (company) => {
  const billing = company.billing || {};
  const credits = billing.creditsRemaining === null || billing.creditsRemaining === undefined
    ? "not configured"
    : String(billing.creditsRemaining);
  return `Your current plan is ${label(company.plan)}. The subscription status is ${label(billing.status)}, and the payment status is ${label(billing.paymentStatus)}. Trial end date: ${fmtDate(billing.trialEndDate)}. Renewal date: ${fmtDate(billing.renewalDate)}. Contract end date: ${fmtDate(billing.contractEndDate)}. Remaining AI credits or allowance: ${credits}.`;
};

const companyReply = (company) => `The company information currently stored is:\nCompany name: ${company.displayName || company.name}\nCountry: ${company.country || "not configured"}\nAddress: ${company.address || "not configured"}\nWebsite: ${company.website || "not configured"}\nEmail: ${company.email || "not configured"}\nPhone: ${company.phone || "not configured"}.`;

const usersReply = async (company) => {
  const memberships = await CompanyMembership.find({ companyId: company._id })
    .populate("userId", "name email accountStatus invitationStatus invitationSentAt invitationExpiresAt")
    .sort({ createdAt: 1 })
    .lean();
  const active = memberships.filter((item) => item.status === "active").length;
  const rows = memberships.map((item) => {
    const user = item.userId || {};
    return `- ${user.name || user.email || "Unknown user"} (${user.email || "no email"}): role ${item.role}, account ${label(user.accountStatus)}, invitation ${label(user.invitationStatus)}`;
  });
  return `Your company currently has ${active} active user${active === 1 ? "" : "s"} out of a maximum of ${company.maxUsers}.\n${rows.length ? rows.join("\n") : "No user records were found."}`;
};

const appsReply = async (company) => {
  const installations = await CompanyAppInstallation.find({ companyId: company._id }).sort({ appSlug: 1 }).lean();
  if (!installations.length) return "No applications are currently activated for your company. A Terrapeak team member can review app availability for your plan.";
  const rows = installations.map((item) => `- ${item.appSlug}: ${item.enabled ? "enabled" : "disabled"}, status ${label(item.status)}`);
  return `Your current application setup is:\n${rows.join("\n")}`;
};

const detectIntent = (text) => {
  if (USER_WORDS.test(text)) return "user_info";
  if (COMPANY_WORDS.test(text)) return "company_info";
  if (APP_WORDS.test(text)) return "app_info";
  if (BILLING_WORDS.test(text)) return "account_billing_info";
  return null;
};

export const createAutomaticSupportReply = async ({ companyId, subject, body }) => {
  const latestMessage = String(body || "").trim();
  const fallbackSubject = String(subject || "").trim();
  const request = latestMessage || fallbackSubject;
  if (!request || ACTION_WORDS.test(request)) return null;

  const intent = detectIntent(request);
  if (!intent) return null;

  const company = await Company.findById(companyId).lean();
  if (!company) return null;

  if (intent === "user_info") return { intent, body: await usersReply(company) };
  if (intent === "company_info") return { intent, body: companyReply(company) };
  if (intent === "app_info") return { intent, body: await appsReply(company) };
  return { intent, body: billingReply(company) };
};
