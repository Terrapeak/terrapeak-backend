import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";

const PHONE = /\+?\d[\d\s().-]{5,30}\d/;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const TTL = 15 * 60 * 1000;
const reply = (body) => ({ handled: true, body });
const firstName = (user) => String(user?.name || "").trim().split(/\s+/)[0] || "there";
const clearPending = async (conversation) => { conversation.pendingAction = null; await conversation.save(); };

const isAmbiguousPhoneRequest = (text) => {
  const hasChange = /\b(change|update|edit|set)\b/i.test(text);
  const hasNumberWord = /\b(number|phone|telephone|contact number)\b/i.test(text);
  const hasPhone = PHONE.test(text);
  const explicitSelf = /\b(my|mine|personal|myself)\b/i.test(text);
  const explicitCompany = /\b(company|business|organisation|organization|our)\b/i.test(text);
  const explicitOther = EMAIL.test(text) || /\b(for|user|member|employee|colleague)\b/i.test(text);
  return hasChange && hasNumberWord && hasPhone && !explicitSelf && !explicitCompany && !explicitOther;
};

const createUpdateAction = async ({ conversation, requester, scope, phone }) => {
  if (scope === "company") {
    const company = await Company.findById(conversation.companyId);
    if (!company) return reply("I could not find your company record, so no change was made.");
    conversation.pendingAction = {
      type: "update_company_info",
      companyField: "phone",
      oldValue: String(company.phone || ""),
      newValue: phone,
      targetScope: "company",
      requestedByUserId: requester._id,
      expiresAt: new Date(Date.now() + TTL),
    };
    await conversation.save();
    return reply(`Thanks, ${firstName(requester)}. Your current company phone number is ${company.phone || "not configured"}. Please confirm that you want to change it to ${phone}. Reply with “confirm” within 15 minutes, or “cancel” to stop.`);
  }

  const membership = await CompanyMembership.findOne({ companyId: conversation.companyId, userId: requester._id });
  if (!membership || membership.status === "removed") return reply(`I found your Terrapeak account, ${firstName(requester)}, but it is not currently connected to this company. Please ask a company owner or administrator to restore your access.`);
  const conflict = await User.findOne({ phone, _id: { $ne: requester._id } }).select("_id");
  if (conflict) return reply("That phone number is already in use by another account. Please provide a different number.");
  conversation.pendingAction = {
    type: "update_user",
    targetUserId: requester._id,
    membershipId: membership._id,
    targetEmail: requester.email,
    targetScope: "self",
    userField: "phone",
    oldValue: String(requester.phone || ""),
    newValue: phone,
    requestedByUserId: requester._id,
    expiresAt: new Date(Date.now() + TTL),
  };
  await conversation.save();
  return reply(`Thanks, ${firstName(requester)}. Your current personal phone number is ${requester.phone || "not configured"}. Please confirm that you want to change it to ${phone}. Reply with “confirm” within 15 minutes, or “cancel” to stop.`);
};

export const handleSupportClarification = async ({ conversation, requester, body }) => {
  const text = String(body || "").trim();
  if (!text) return null;

  if (conversation.pendingAction?.type === "clarify_phone_target") {
    if (/^(cancel|stop|never mind|nevermind)$/i.test(text)) {
      await clearPending(conversation);
      return reply("No problem. I cancelled that phone-number change.");
    }
    const phone = conversation.pendingAction.newValue;
    if (/\b(my|mine|personal|myself)\b/i.test(text)) return createUpdateAction({ conversation, requester, scope: "self", phone });
    if (/\b(company|business|organisation|organization|our)\b/i.test(text)) return createUpdateAction({ conversation, requester, scope: "company", phone });
    return reply(`Just to make sure I update the right record, ${firstName(requester)}: is ${phone} your personal phone number or the company phone number? Reply “personal” or “company”.`);
  }

  if (!isAmbiguousPhoneRequest(text)) return null;
  const phone = text.match(PHONE)?.[0]?.trim();
  conversation.pendingAction = {
    type: "clarify_phone_target",
    targetScope: "unknown",
    newValue: phone,
    requestedByUserId: requester._id,
    expiresAt: new Date(Date.now() + TTL),
  };
  await conversation.save();
  return reply(`Of course, ${firstName(requester)}. Do you want to change your personal phone number or the company phone number to ${phone}? Reply “personal” or “company”.`);
};
