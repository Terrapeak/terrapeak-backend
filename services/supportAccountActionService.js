import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";
import { issueInvitation, issuePasswordReset } from "./userLifecycleService.js";

const CONFIRM_WORDS = /^(confirm|confirmed|yes|yes please|proceed|go ahead|do it)$/i;
const CANCEL_WORDS = /^(cancel|no|stop|do not proceed|don't proceed)$/i;
const RESEND_INVITE_WORDS = /\b(resend|send again|new)\b[\s\S]{0,40}\b(invitation|invite|invitation link|invite link)\b|\b(invitation|invite|invitation link|invite link)\b[\s\S]{0,40}\b(resend|send again|new)\b/i;
const PASSWORD_RESET_WORDS = /\b(password reset|reset password|forgot password|password link|reset link|reset the password|change password|send (?:me |a )?password reset|password recovery)\b/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const ACTION_TTL_MS = 15 * 60 * 1000;
const ADMIN_ROLES = new Set(["owner", "admin"]);
const ACTIVITY_LIMIT = 50;

const assistantResult = (body, { completed = false } = {}) => ({ handled: true, body, completed });

const appendActivity = async ({ companyId, title, requester, targetUser, metadata = {} }) => {
  await Company.updateOne(
    { _id: companyId },
    { $push: { activityEvents: { $each: [{ eventType: "updated", title, appSlug: "support-automation", appName: "Support Automation", actorUserId: requester?._id || null, actorName: requester?.name || "", actorEmail: requester?.email || "", createdAt: new Date(), metadata: { targetUserId: targetUser?._id || null, targetEmail: targetUser?.email || "", ...metadata } }], $position: 0, $slice: ACTIVITY_LIMIT } } }
  );
};

const findTargetMembership = async ({ companyId, email }) => {
  const memberships = await CompanyMembership.find({ companyId, status: "active" })
    .populate("userId", "name email accountStatus invitationStatus")
    .lean();
  return memberships.find((item) => item.userId?.email?.toLowerCase() === email.toLowerCase()) || null;
};

const executePendingAction = async ({ conversation, requester }) => {
  const pending = conversation.pendingAction;
  if (!pending) return null;
  if (String(pending.requestedByUserId) !== String(requester._id)) return assistantResult("This pending action can only be confirmed by the person who requested it.");
  if (new Date(pending.expiresAt) <= new Date()) {
    conversation.pendingAction = null;
    await conversation.save();
    return assistantResult("That confirmation request has expired. Please submit the request again.");
  }

  const membership = await CompanyMembership.findOne({ _id: pending.membershipId, companyId: conversation.companyId, userId: pending.targetUserId, status: "active" });
  const [company, targetUser] = await Promise.all([Company.findById(conversation.companyId), User.findById(pending.targetUserId)]);
  if (!membership || !company || !targetUser) {
    conversation.pendingAction = null;
    await conversation.save();
    return assistantResult("The selected company user could not be found. No action was performed.");
  }

  if (pending.type === "resend_invitation") {
    await issueInvitation({ user: targetUser, company, role: membership.role });
    await appendActivity({ companyId: company._id, title: "Company invitation resent through support automation", requester, targetUser });
    conversation.pendingAction = null;
    await conversation.save();
    return assistantResult(`A new invitation email has been sent to ${targetUser.email}.`, { completed: true });
  }

  await issuePasswordReset({ user: targetUser });
  await appendActivity({ companyId: company._id, title: "Password reset email sent through support automation", requester, targetUser });
  conversation.pendingAction = null;
  await conversation.save();
  return assistantResult(`A password-reset email has been sent to ${targetUser.email}.`, { completed: true });
};

export const handleSupportAccountAction = async ({ conversation, requesterMembership, requester, body }) => {
  const request = String(body || "").trim();
  if (!request) return null;

  if (conversation.pendingAction) {
    if (CANCEL_WORDS.test(request)) {
      if (String(conversation.pendingAction.requestedByUserId) !== String(requester._id)) return assistantResult("This pending action can only be cancelled by the person who requested it.");
      conversation.pendingAction = null;
      await conversation.save();
      return assistantResult("The pending account action has been cancelled. No changes were made.");
    }
    if (CONFIRM_WORDS.test(request)) return executePendingAction({ conversation, requester });
  }

  const actionType = PASSWORD_RESET_WORDS.test(request) ? "password_reset" : RESEND_INVITE_WORDS.test(request) ? "resend_invitation" : null;
  if (!actionType) return null;

  const explicitEmail = request.match(EMAIL_PATTERN)?.[0]?.toLowerCase() || null;
  const targetEmail = explicitEmail || (actionType === "password_reset" ? requester.email.toLowerCase() : null);
  if (!targetEmail) return assistantResult("Please provide the email address of the company user whose invitation should be resent.");

  const targetMembership = await findTargetMembership({ companyId: conversation.companyId, email: targetEmail });
  if (!targetMembership?.userId) return assistantResult(`No active company user was found with the email address ${targetEmail}. No action was performed.`);

  const isSelf = String(targetMembership.userId._id) === String(requester._id);
  const canManageOthers = ADMIN_ROLES.has(requesterMembership.role);
  if (!isSelf && !canManageOthers) return assistantResult("Only a company owner or administrator can request this action for another user.");
  if (actionType === "resend_invitation" && !canManageOthers) return assistantResult("Only a company owner or administrator can resend company invitations.");
  if (actionType === "resend_invitation" && targetMembership.userId.invitationStatus === "accepted") return assistantResult(`${targetEmail} has already accepted the invitation. A password reset may be more appropriate if access is the issue.`);

  conversation.pendingAction = { type: actionType, membershipId: targetMembership._id, targetUserId: targetMembership.userId._id, targetEmail, requestedByUserId: requester._id, expiresAt: new Date(Date.now() + ACTION_TTL_MS) };
  await conversation.save();

  const actionLabel = actionType === "password_reset" ? "send a password-reset email" : "resend the company invitation";
  return assistantResult(`Please confirm that you want me to ${actionLabel} to ${targetEmail}. Reply with “confirm” within 15 minutes to proceed, or “cancel” to stop.`);
};
