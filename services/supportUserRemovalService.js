import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";

const CONFIRM = /^(confirm|confirmed|yes|yes please|proceed|go ahead|do it)$/i;
const CANCEL = /^(cancel|no|stop|do not proceed|don't proceed)$/i;
const ACTION_WORDS = /\b(deactivate|disable|remove|delete)\b/i;
const USER_WORDS = /\b(user|member|employee|colleague|account)\b/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const ADMIN_ROLES = new Set(["owner", "admin"]);
const TTL = 15 * 60 * 1000;

const reply = (body, completed = false) => ({ handled: true, body, completed });

const detectAction = (text) => (/\b(remove|delete)\b/i.test(text) ? "remove_user" : "deactivate_user");
const isRemovalRequest = (text) => ACTION_WORDS.test(text) && (EMAIL.test(text) || USER_WORDS.test(text));

const findTarget = async (companyId, email) => {
  const user = await User.findOne({ email });
  if (!user) return {};
  const membership = await CompanyMembership.findOne({ companyId, userId: user._id });
  return { user, membership };
};

const validate = async ({ conversation, requester, requesterMembership, user, membership, action }) => {
  if (!ADMIN_ROLES.has(requesterMembership.role)) return "Only a company owner or administrator can deactivate or remove users.";
  if (!user || !membership) return "No company user was found with that email address.";
  if (String(user._id) === String(requester._id)) return "You cannot deactivate or remove your own company membership through support automation.";
  if (user.platformRole && user.platformRole !== "none") return "Platform-level accounts cannot be deactivated or removed through customer support automation.";
  if (membership.role === "owner" && membership.isActive) {
    const ownerCount = await CompanyMembership.countDocuments({ companyId: conversation.companyId, role: "owner", isActive: true });
    if (ownerCount <= 1) return "The last active company owner cannot be deactivated or removed.";
  }
  if (action === "deactivate_user" && !membership.isActive) return "This company user is already inactive.";
  return null;
};

const appendActivity = async ({ companyId, requester, user, action }) => {
  const actionLabel = action === "remove_user" ? "removed from company" : "deactivated";
  await Company.updateOne(
    { _id: companyId },
    {
      $push: {
        activityEvents: {
          $each: [{
            eventType: "updated",
            title: `Company user ${actionLabel} through support automation`,
            appSlug: "support-automation",
            appName: "Support Automation",
            actorUserId: requester._id,
            actorName: requester.name || "",
            actorEmail: requester.email || "",
            createdAt: new Date(),
            metadata: { targetUserId: user._id, targetEmail: user.email, action },
          }],
          $position: 0,
          $slice: 50,
        },
      },
    },
  );
};

const execute = async ({ conversation, requester, requesterMembership }) => {
  const pending = conversation.pendingAction;
  if (String(pending.requestedByUserId) !== String(requester._id)) {
    return reply("This pending action can only be confirmed by the person who requested it.");
  }
  if (new Date(pending.expiresAt) <= new Date()) {
    conversation.pendingAction = null;
    await conversation.save();
    return reply("That confirmation request has expired. Please submit the request again.");
  }

  const { user, membership } = await findTarget(conversation.companyId, pending.targetEmail);
  const error = await validate({
    conversation,
    requester,
    requesterMembership,
    user,
    membership,
    action: pending.type,
  });
  if (error) {
    conversation.pendingAction = null;
    await conversation.save();
    return reply(`${error} No change was made.`);
  }

  if (pending.type === "remove_user") {
    await CompanyMembership.deleteOne({ _id: membership._id });
  } else {
    membership.isActive = false;
    await membership.save();
  }

  await appendActivity({ companyId: conversation.companyId, requester, user, action: pending.type });
  conversation.pendingAction = null;
  await conversation.save();

  if (pending.type === "remove_user") {
    return reply(`${user.email} has been removed from the company. The underlying Terrapeak user account was not deleted.`, true);
  }
  return reply(`${user.email} has been deactivated for this company. The membership can be reactivated later.`, true);
};

export const handleSupportUserRemoval = async ({ conversation, requesterMembership, requester, body }) => {
  const text = String(body || "").trim();
  if (!text) return null;

  const hasPending = ["deactivate_user", "remove_user"].includes(conversation.pendingAction?.type);
  if (hasPending) {
    if (CANCEL.test(text)) {
      if (String(conversation.pendingAction.requestedByUserId) !== String(requester._id)) {
        return reply("This pending action can only be cancelled by the person who requested it.");
      }
      conversation.pendingAction = null;
      await conversation.save();
      return reply("The pending user action has been cancelled. No change was made.");
    }
    if (CONFIRM.test(text)) return execute({ conversation, requester, requesterMembership });
  }

  if (!isRemovalRequest(text)) return null;
  if (!ADMIN_ROLES.has(requesterMembership.role)) {
    return reply("Only a company owner or administrator can deactivate or remove users.");
  }

  const email = text.match(EMAIL)?.[0]?.toLowerCase() || "";
  if (!email) return reply("Please provide the email address of the company user you want to deactivate or remove.");

  const action = detectAction(text);
  const { user, membership } = await findTarget(conversation.companyId, email);
  const error = await validate({ conversation, requester, requesterMembership, user, membership, action });
  if (error) return reply(`${error} No change was made.`);

  conversation.pendingAction = {
    type: action,
    targetUserId: user._id,
    membershipId: membership._id,
    targetEmail: email,
    requestedByUserId: requester._id,
    expiresAt: new Date(Date.now() + TTL),
  };
  await conversation.save();

  if (action === "remove_user") {
    return reply(`Please confirm that you want to remove ${email} from this company. This removes only the company membership and does not delete the underlying Terrapeak user account. Reply with “confirm” within 15 minutes to proceed, or “cancel” to stop.`);
  }
  return reply(`Please confirm that you want to deactivate ${email} for this company. This is reversible. Reply with “confirm” within 15 minutes to proceed, or “cancel” to stop.`);
};