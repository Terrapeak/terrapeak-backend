import crypto from "crypto";
import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";
import { issueInvitation } from "./userLifecycleService.js";

const CONFIRM_WORDS = /^(confirm|confirmed|yes|yes please|proceed|go ahead|do it)$/i;
const CANCEL_WORDS = /^(cancel|no|stop|do not proceed|don't proceed)$/i;
const ADD_USER_WORDS = /\b(add|create|invite)\b[\s\S]{0,30}\b(user|member|employee|colleague)\b/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /\+?\d[\d\s().-]{5,30}\d/;
const ROLES = new Set(["owner", "admin", "manager", "staff", "viewer"]);
const ADMIN_ROLES = new Set(["owner", "admin"]);
const ACTION_TTL_MS = 15 * 60 * 1000;
const ACTIVITY_LIMIT = 50;

const result = (body, completed = false) => ({ handled: true, body, completed });
const createInternalPassword = () => crypto.randomBytes(24).toString("base64url");
const normalizeRole = (value) => value?.toLowerCase() === "user" ? "staff" : value?.toLowerCase() || "";

const parseDetails = (text) => {
  const email = text.match(EMAIL_PATTERN)?.[0]?.toLowerCase() || "";
  const phone = text.match(PHONE_PATTERN)?.[0]?.trim() || "";
  const parts = text.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
  const labelledRole = text.match(/\brole\s*(?:is|:)?\s*(owner|admin|manager|staff|viewer|user)\b/i)?.[1] || "";
  const standaloneRole = parts.find((part) => /^(owner|admin|manager|staff|viewer|user)$/i.test(part)) || "";
  const role = normalizeRole(labelledRole || standaloneRole);
  const labelledName = text.match(/\bname\s*(?:is|:)?\s*([^,;\n]+)/i)?.[1]?.trim() || "";
  const labelledCountry = text.match(/\bcountry\s*(?:is|:)?\s*([^,;\n]+)/i)?.[1]?.trim() || "";
  const firstPart = parts[0]?.replace(/^.*?\b(?:user|member|employee|colleague)\b\s*:?\s*/i, "").trim() || "";
  const name = labelledName || (firstPart && !EMAIL_PATTERN.test(firstPart) ? firstPart : "");
  const country = labelledCountry || parts.find((part, index) => index > 0 && !EMAIL_PATTERN.test(part) && !PHONE_PATTERN.test(part) && !/\brole\b/i.test(part) && !/^(owner|admin|manager|staff|viewer|user)$/i.test(part)) || "";
  return { name, email, phone, country, role };
};

const detailsFromPending = (pending) => ({
  name: pending?.targetName || "",
  email: pending?.targetEmail || "",
  phone: pending?.targetPhone || "",
  country: pending?.targetCountry || "",
  role: pending?.targetRole || "",
});

const mergeDetails = (existing, incoming) => ({
  name: incoming.name || existing.name,
  email: incoming.email || existing.email,
  phone: incoming.phone || existing.phone,
  country: incoming.country || existing.country,
  role: incoming.role || existing.role,
});

const missingFields = (details) => ["name", "email", "phone", "country", "role"].filter((field) => !details[field]);

const savePending = async ({ conversation, requester, details }) => {
  conversation.pendingAction = {
    type: "add_user",
    targetEmail: details.email,
    targetName: details.name,
    targetPhone: details.phone,
    targetCountry: details.country,
    targetRole: details.role,
    requestedByUserId: requester._id,
    expiresAt: new Date(Date.now() + ACTION_TTL_MS),
  };
  await conversation.save();
};

const appendActivity = async ({ companyId, requester, user, role }) => {
  await Company.updateOne(
    { _id: companyId },
    { $push: { activityEvents: { $each: [{ eventType: "updated", title: "Company user invited through support automation", appSlug: "support-automation", appName: "Support Automation", actorUserId: requester._id, actorName: requester.name || "", actorEmail: requester.email || "", createdAt: new Date(), metadata: { userId: user._id, email: user.email, role } }], $position: 0, $slice: ACTIVITY_LIMIT } } }
  );
};

const validateBeforeCreate = async ({ company, details }) => {
  const activeCount = await CompanyMembership.countDocuments({
    companyId: company._id,
    status: "active",
  });
  if (activeCount >= company.maxUsers) return `This company has reached its maximum of ${company.maxUsers} active users.`;
  const existingUser = await User.findOne({ email: details.email });
  if (existingUser) {
    const membership = await CompanyMembership.findOne({ companyId: company._id, userId: existingUser._id });
    if (membership?.status === "active") return "This user already belongs to the company.";
    if (existingUser.phone !== details.phone) return "An account with this email already exists with different phone details. A Terrapeak administrator must review it.";
  }
  const phoneConflict = await User.findOne({ phone: details.phone, email: { $ne: details.email } }).select("_id");
  if (phoneConflict) return "This phone number is already in use.";
  return null;
};

const executeAddUser = async ({ conversation, requester }) => {
  const pending = conversation.pendingAction;
  if (String(pending.requestedByUserId) !== String(requester._id)) return result("This pending action can only be confirmed by the person who requested it.");
  if (new Date(pending.expiresAt) <= new Date()) {
    conversation.pendingAction = null;
    await conversation.save();
    return result("That confirmation request has expired. Please submit the request again.");
  }
  const company = await Company.findById(conversation.companyId);
  if (!company) return result("The company record could not be found. No user was created.");
  const details = detailsFromPending(pending);
  const validationError = await validateBeforeCreate({ company, details });
  if (validationError) {
    conversation.pendingAction = null;
    await conversation.save();
    return result(`${validationError} No user was created.`);
  }

  let user = await User.findOne({ email: details.email });
  let membership = null;
  let createdUser = false;
  if (!user) {
    user = await User.create({ name: details.name, email: details.email, phone: details.phone, password: createInternalPassword(), country: details.country, companyName: company.name, role: "user", isAdmin: false, platformRole: "none", isApproved: false, accountStatus: "pending", invitationStatus: "not_invited" });
    createdUser = true;
  } else {
    user.name = details.name;
    user.country = details.country;
    user.companyName = company.name;
    await user.save();
  }

  membership = await CompanyMembership.findOne({ companyId: company._id, userId: user._id });
  if (membership) {
    membership.role = details.role;
    membership.status = "active";
    await membership.save();
  } else {
    membership = await CompanyMembership.create({
      companyId: company._id,
      userId: user._id,
      role: details.role,
      status: "active",
    });
  }

  try {
    await issueInvitation({ user, company, role: details.role });
  } catch (error) {
    if (createdUser) {
      await CompanyMembership.deleteOne({ _id: membership._id });
      await User.deleteOne({ _id: user._id });
    } else {
      membership.status = "inactive";
      await membership.save();
    }
    throw error;
  }

  await appendActivity({ companyId: company._id, requester, user, role: details.role });
  conversation.pendingAction = null;
  await conversation.save();
  return result(`The user ${details.name} has been added as ${details.role}, and an invitation email has been sent to ${details.email}.`, true);
};

export const handleSupportUserCreation = async ({ conversation, requesterMembership, requester, body }) => {
  const text = String(body || "").trim();
  if (!text) return null;
  const pendingAddUser = conversation.pendingAction?.type === "add_user";

  if (pendingAddUser) {
    if (String(conversation.pendingAction.requestedByUserId) !== String(requester._id)) return result("This pending action can only be continued, confirmed or cancelled by the person who requested it.");
    if (CANCEL_WORDS.test(text)) {
      conversation.pendingAction = null;
      await conversation.save();
      return result("The pending user creation has been cancelled. No user was created.");
    }
    if (CONFIRM_WORDS.test(text)) {
      const missing = missingFields(detailsFromPending(conversation.pendingAction));
      if (missing.length) return result(`I still need the following details before confirmation: ${missing.join(", ")}.`);
      return executeAddUser({ conversation, requester });
    }

    const details = mergeDetails(detailsFromPending(conversation.pendingAction), parseDetails(text));
    await savePending({ conversation, requester, details });
    const missing = missingFields(details);
    if (missing.length) return result(`Please provide the following missing details: ${missing.join(", ")}. You can send only the missing information in your next message.`);
    return result(`Please confirm that you want to add ${details.name} (${details.email}, ${details.phone}, ${details.country}) as ${details.role}. Reply with “confirm” within 15 minutes to proceed, or “cancel” to stop.`);
  }

  if (!ADD_USER_WORDS.test(text)) return null;
  if (!ADMIN_ROLES.has(requesterMembership.role)) return result("Only a company owner or administrator can add users.");

  const details = parseDetails(text);
  await savePending({ conversation, requester, details });
  const missing = missingFields(details);
  if (missing.length) return result(`Please provide the following missing details: ${missing.join(", ")}. Example: Add user: Jane Smith, jane@example.com, +60123456789, Malaysia, role staff.`);
  if (!ROLES.has(details.role)) return result("The user role must be owner, admin, manager, staff or viewer. The word user is treated as staff.");

  const company = await Company.findById(conversation.companyId);
  if (!company) return result("The company record could not be found. No user was created.");
  const validationError = await validateBeforeCreate({ company, details });
  if (validationError) {
    conversation.pendingAction = null;
    await conversation.save();
    return result(`${validationError} No user was created.`);
  }

  return result(`Please confirm that you want to add ${details.name} (${details.email}, ${details.phone}, ${details.country}) as ${details.role}. Reply with “confirm” within 15 minutes to proceed, or “cancel” to stop.`);
};
