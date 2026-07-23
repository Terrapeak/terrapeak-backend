import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";

const CONFIRM = /^(confirm|confirmed|yes|yes please|proceed|go ahead|do it)$/i;
const CANCEL = /^(cancel|no|stop|do not proceed|don't proceed)$/i;
const UPDATE_USER = /\b(change|update|edit|set|reactivate|restore)\b[\s\S]{0,60}\b(user|member|employee|colleague|role|phone|number|country|name|membership)\b|\b(user|member|employee|colleague|role|phone|number|country|name|membership)\b[\s\S]{0,60}\b(change|update|edit|set|reactivate|restore)\b|\b(reactivate|restore)\b[\s\S]{0,60}\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /\+?\d[\d\s().-]{5,30}\d/;
const ROLES = new Set(["owner", "admin", "manager", "staff", "viewer"]);
const ADMIN_ROLES = new Set(["owner", "admin"]);
const TTL = 15 * 60 * 1000;
const LABELS = { name: "name", phone: "phone number", country: "country", role: "company role", membership: "company access" };
const reply = (body, completed = false) => ({ handled: true, body, completed });
const show = (value) => String(value || "not configured");
const firstName = (user) => String(user?.name || user?.email || "").trim().split(/\s+/)[0] || "there";
const membershipState = (membership) => membership?.status || "inactive";

const parseChange = (text, requester) => {
  const explicitEmail = text.match(EMAIL)?.[0]?.toLowerCase() || "";
  const isSelfRequest = /\b(my|me|myself)\b/i.test(text);
  const email = explicitEmail || (isSelfRequest ? String(requester?.email || "").toLowerCase() : "");
  if (/\b(reactivate|restore)\b/i.test(text)) return { email, field: "membership", value: "active", isSelfRequest };
  const role = text.match(/\b(?:to|as|role\s*(?:to|is|:)?)\s*(owner|admin|manager|staff|viewer|user)\b/i)?.[1];
  if (/\brole\b/i.test(text) && role) return { email, field: "role", value: role.toLowerCase() === "user" ? "staff" : role.toLowerCase(), isSelfRequest };
  const phone = text.match(PHONE)?.[0]?.trim();
  if (/\b(phone|telephone|contact number|number)\b/i.test(text) && phone) return { email, field: "phone", value: phone, isSelfRequest };
  const country = text.match(/\bcountry\s*(?:to|as|is|:)?\s*([^,;\n]+)$/i)?.[1]?.trim();
  if (/\bcountry\b/i.test(text) && country) return { email, field: "country", value: country.replace(/[.]+$/, ""), isSelfRequest };
  const name = text.match(/\bname\s*(?:to|as|is|:)?\s*([^,;\n]+)$/i)?.[1]?.trim();
  if (/\bname\b/i.test(text) && name) return { email, field: "name", value: name.replace(/[.]+$/, ""), isSelfRequest };
  return { email, field: "", value: "", isSelfRequest };
};

const findTarget = async (companyId, email) => {
  const user = await User.findOne({ email });
  if (!user) return {};
  const membership = await CompanyMembership.findOne({ companyId, userId: user._id });
  return { user, membership };
};

const appendActivity = async ({ companyId, requester, target, field, oldValue, newValue }) => {
  await Company.updateOne({ _id: companyId }, { $push: { activityEvents: { $each: [{ eventType: "updated", title: `Company user ${LABELS[field]} updated through support automation`, appSlug: "support-automation", appName: "Support Automation", actorUserId: requester._id, actorName: requester.name || "", actorEmail: requester.email || "", createdAt: new Date(), metadata: { targetUserId: target._id, targetEmail: target.email, field, oldValue, newValue } }], $position: 0, $slice: 50 } } });
};

const validate = async ({ conversation, requester, requesterMembership, targetUser, membership, field, value }) => {
  if (!targetUser) return "I could not find a Terrapeak account with that email address.";
  if (!membership) return "I found the Terrapeak account, but it has never been connected to this company. Please use the add-user flow to invite it.";
  const isSelf = String(targetUser._id) === String(requester._id);
  if (!isSelf && !ADMIN_ROLES.has(requesterMembership.role)) return "Only a company owner or administrator can update another user.";
  if (field === "role") {
    if (isSelf) return "You cannot change your own company role through support automation.";
    if (!ROLES.has(value)) return "The role must be owner, admin, manager, staff or viewer.";
    if (membership.role === "owner" && value !== "owner") {
      const ownerCount = await CompanyMembership.countDocuments({
        companyId: conversation.companyId,
        role: "owner",
        status: "active",
      });
      if (ownerCount <= 1) return "The last active company owner cannot be downgraded.";
    }
  }
  if (field === "phone") {
    if (!/^\+?[\d][\d\s().-]{5,30}$/.test(value)) return "The new phone number is not valid.";
    const conflict = await User.findOne({ phone: value, _id: { $ne: targetUser._id } }).select("_id");
    if (conflict) return "This phone number is already in use.";
  }
  if (field === "membership") {
    if (isSelf) return "You cannot restore your own company access through support automation. Please ask a company owner or administrator.";
    if (!ADMIN_ROLES.has(requesterMembership.role)) return "Only a company owner or administrator can restore another user.";
    if (membershipState(membership) === "active") return "This user is already active in the company.";
  }
  return null;
};

const execute = async ({ conversation, requester, requesterMembership }) => {
  const pending = conversation.pendingAction;
  if (String(pending.requestedByUserId) !== String(requester._id)) return reply("This pending action can only be confirmed by the person who requested it.");
  if (new Date(pending.expiresAt) <= new Date()) {
    conversation.pendingAction = null;
    await conversation.save();
    return reply("That confirmation request has expired. Please submit the update again.");
  }
  const { user, membership } = await findTarget(conversation.companyId, pending.targetEmail);
  const error = await validate({ conversation, requester, requesterMembership, targetUser: user, membership, field: pending.userField, value: pending.newValue });
  if (error) {
    conversation.pendingAction = null;
    await conversation.save();
    return reply(`${error} No change was made.`);
  }
  if (pending.userField === "role") membership.role = pending.newValue;
  else if (pending.userField === "membership") {
    membership.status = "active";
    membership.removedAt = null;
    membership.removedByUserId = null;
  } else user[pending.userField] = pending.newValue;
  if (pending.userField === "role" || pending.userField === "membership") await membership.save();
  else await user.save();
  await appendActivity({ companyId: conversation.companyId, requester, target: user, field: pending.userField, oldValue: pending.oldValue, newValue: pending.newValue });
  conversation.pendingAction = null;
  await conversation.save();
  if (pending.userField === "membership") return reply(`${user.name || user.email} now has active company access again with the role ${membership.role}.`, true);
  return reply(`Done, ${firstName(requester)}. The ${LABELS[pending.userField]} for ${user.name || user.email} has been updated from ${show(pending.oldValue)} to ${pending.newValue}.`, true);
};

export const handleSupportUserUpdate = async ({ conversation, requesterMembership, requester, body }) => {
  const text = String(body || "").trim();
  if (!text) return null;
  if (conversation.pendingAction?.type === "update_user") {
    if (CANCEL.test(text)) {
      if (String(conversation.pendingAction.requestedByUserId) !== String(requester._id)) return reply("This pending action can only be cancelled by the person who requested it.");
      conversation.pendingAction = null;
      await conversation.save();
      return reply("No problem. The pending user update has been cancelled and no change was made.");
    }
    if (CONFIRM.test(text)) return execute({ conversation, requester, requesterMembership });
  }
  if (!UPDATE_USER.test(text)) return null;
  const { email, field, value } = parseChange(text, requester);
  if (!email) return reply(`Of course, ${firstName(requester)}. Who would you like to update? Please provide their email address, or say “my” for your own details.`);
  if (!field || !value) return reply("What would you like to change: name, phone number, country, company role, or company access?");
  const { user, membership } = await findTarget(conversation.companyId, email);
  const error = await validate({ conversation, requester, requesterMembership, targetUser: user, membership, field, value });
  if (error) return reply(`${error} No change was made.`);
  const state = membershipState(membership);
  const oldValue = field === "role" ? membership.role : field === "membership" ? state : user[field];
  if (String(oldValue || "") === String(value)) return reply(`${user.name || email} already has ${LABELS[field]} set to ${value}. No change is needed.`);
  conversation.pendingAction = { type: "update_user", targetUserId: user._id, membershipId: membership._id, targetEmail: email, userField: field, oldValue: String(oldValue || ""), newValue: value, requestedByUserId: requester._id, expiresAt: new Date(Date.now() + TTL) };
  await conversation.save();
  if (field === "membership" && state === "removed") return reply(`I found ${user.name || email}. They were previously removed from the company, but their former role ${membership.role} was preserved. Would you like me to restore their company access with that role? Reply “confirm” within 15 minutes, or “cancel” to stop.`);
  if (field === "membership") return reply(`${user.name || email} is currently deactivated with the role ${membership.role}. Would you like me to reactivate their company access? Reply “confirm” within 15 minutes, or “cancel” to stop.`);
  return reply(`The current ${LABELS[field]} for ${user.name || email} is ${show(oldValue)}. Please confirm that you want to change it to ${value}. Reply “confirm” within 15 minutes, or “cancel” to stop.`);
};
