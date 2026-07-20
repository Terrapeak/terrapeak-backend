import Company from "../models/company.js";

const CONFIRM_WORDS = /^(confirm|confirmed|yes|yes please|proceed|go ahead|do it)$/i;
const CANCEL_WORDS = /^(cancel|no|stop|do not proceed|don't proceed)$/i;
const UPDATE_WORDS = /\b(change|update|edit|set|replace|correct)\b/i;
const ADMIN_ROLES = new Set(["owner", "admin"]);
const ACTION_TTL_MS = 15 * 60 * 1000;
const ACTIVITY_LIMIT = 50;

const FIELD_LABELS = {
  displayName: "company display name",
  address: "company address",
  website: "company website",
  email: "company email",
  phone: "company phone number",
  country: "company country",
};

const result = (body, completed = false) => ({ handled: true, body, completed });
const show = (value) => String(value || "not configured");

const detectField = (text) => {
  if (/\b(display name|company name)\b/i.test(text)) return "displayName";
  if (/\b(address|office address|business address)\b/i.test(text)) return "address";
  if (/\b(website|web site|url)\b/i.test(text)) return "website";
  if (/\b(company email|business email|contact email)\b/i.test(text)) return "email";
  if (/\b(phone|phone number|telephone|contact number)\b/i.test(text)) return "phone";
  if (/\b(country)\b/i.test(text)) return "country";
  return null;
};

const extractValue = (text, field) => {
  if (field === "email") return text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] || "";
  if (field === "website") return text.match(/https?:\/\/\S+|www\.\S+/i)?.[0] || "";
  const patterns = [
    /\b(?:to|as|is)\s+["']?(.+?)["']?\s*$/i,
    /:\s*["']?(.+?)["']?\s*$/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/[.]+$/, "");
  }
  return "";
};

const validateValue = (field, value) => {
  if (!value || value.length > 500) return false;
  if (field === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (field === "website") return /^(https?:\/\/|www\.)[^\s]+$/i.test(value);
  if (field === "country") return value.length >= 2 && value.length <= 60;
  if (field === "phone") return /^[+\d][\d\s().-]{5,30}$/.test(value);
  return true;
};

const appendActivity = async ({ companyId, requester, field, oldValue, newValue }) => {
  await Company.updateOne(
    { _id: companyId },
    {
      $push: {
        activityEvents: {
          $each: [{
            eventType: "updated",
            title: `${FIELD_LABELS[field]} updated through support automation`,
            appSlug: "support-automation",
            appName: "Support Automation",
            actorUserId: requester._id,
            actorName: requester.name || "",
            actorEmail: requester.email || "",
            createdAt: new Date(),
            metadata: { field, oldValue, newValue },
          }],
          $position: 0,
          $slice: ACTIVITY_LIMIT,
        },
      },
    }
  );
};

export const handleSupportCompanyUpdate = async ({ conversation, requesterMembership, requester, body }) => {
  const text = String(body || "").trim();
  if (!text) return null;

  const pending = conversation.pendingAction;
  if (pending?.type === "update_company_info") {
    if (String(pending.requestedByUserId) !== String(requester._id)) {
      return result("This pending change can only be confirmed or cancelled by the person who requested it.");
    }
    if (CANCEL_WORDS.test(text)) {
      conversation.pendingAction = null;
      await conversation.save();
      return result("The pending company-information update has been cancelled. No changes were made.");
    }
    if (!CONFIRM_WORDS.test(text)) return null;
    if (new Date(pending.expiresAt) <= new Date()) {
      conversation.pendingAction = null;
      await conversation.save();
      return result("That confirmation request has expired. Please submit the update again.");
    }
    const company = await Company.findById(conversation.companyId);
    if (!company) return result("The company record could not be found. No change was made.");
    company[pending.companyField] = pending.newValue;
    await company.save();
    await appendActivity({ companyId: company._id, requester, field: pending.companyField, oldValue: pending.oldValue, newValue: pending.newValue });
    const label = FIELD_LABELS[pending.companyField];
    conversation.pendingAction = null;
    await conversation.save();
    return result(`The ${label} has been updated from ${show(pending.oldValue)} to ${pending.newValue}.`, true);
  }

  if (!UPDATE_WORDS.test(text)) return null;
  const field = detectField(text);
  if (!field) return null;
  if (!ADMIN_ROLES.has(requesterMembership.role)) {
    return result("Only a company owner or administrator can update company information.");
  }
  const newValue = extractValue(text, field);
  if (!validateValue(field, newValue)) {
    return result(`I could not identify a valid new ${FIELD_LABELS[field]}. Please include the complete new value in your request.`);
  }
  const company = await Company.findById(conversation.companyId).lean();
  if (!company) return result("The company record could not be found. No change was made.");
  const oldValue = String(company[field] || "");
  if (oldValue === newValue) return result(`The ${FIELD_LABELS[field]} is already set to ${newValue}. No change is needed.`);

  conversation.pendingAction = {
    type: "update_company_info",
    companyField: field,
    oldValue,
    newValue,
    requestedByUserId: requester._id,
    expiresAt: new Date(Date.now() + ACTION_TTL_MS),
  };
  await conversation.save();
  return result(`Your current ${FIELD_LABELS[field]} is ${show(oldValue)}. Please confirm that you want to change it to ${newValue}. Reply with “confirm” within 15 minutes to proceed, or “cancel” to stop.`);
};
