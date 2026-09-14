import crypto from "node:crypto";
import CompanyMembership from "../models/companyMembership.js";
import ReservationStaffRequest from "../models/reservationStaffRequest.js";
import sendEmail from "../utils/sendEmail.js";
import { getReservationCallbackNotificationSettings } from "../utils/reservationService.js";

const DASHBOARD_CALLBACK_REQUESTS_URL =
  "https://dashboard.terrapeakgroup.com/dashboard/reservations/callback-requests";
const MAX_EMAIL_FIELD_LENGTH = 500;
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const isUsableEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const truncateForEmail = (value, maxLength = MAX_EMAIL_FIELD_LENGTH) =>
  String(value || "").trim().slice(0, maxLength);

const escapeHtml = (value) =>
  truncateForEmail(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getEmailPayload = (request) => {
  const change = request?.requestedChange || {};
  const customerName = truncateForEmail(request?.customerName);
  const customerContact = truncateForEmail(request?.customerContact);
  const preferredTime = truncateForEmail(change.preferredCallbackTime);
  const question = truncateForEmail(change.question);
  const serviceContext = truncateForEmail(change.serviceOrTeacher);
  const receivedAt = request?.createdAt
    ? new Date(request.createdAt).toISOString()
    : new Date().toISOString();
  const subject = customerName
    ? `New callback request — ${customerName}`
    : "New callback request";

  const lines = [
    "A new callback request has been received.",
    "",
    `Customer: ${customerName || "Not provided"}`,
    `Contact: ${customerContact || "Not provided"}`,
    `Preferred time: ${preferredTime || "Not provided"}`,
    `Reason: ${question || "Not provided"}`,
    serviceContext ? `Service/team: ${serviceContext}` : "",
    `Received: ${receivedAt}`,
    "",
    "Review and manage this request:",
    DASHBOARD_CALLBACK_REQUESTS_URL,
  ].filter(Boolean);

  const htmlRows = [
    ["Customer", customerName || "Not provided"],
    ["Contact", customerContact || "Not provided"],
    ["Preferred time", preferredTime || "Not provided"],
    ["Reason", question || "Not provided"],
    ...(serviceContext ? [["Service/team", serviceContext]] : []),
    ["Received", receivedAt],
  ];

  const html = `<div style="font-family:Arial,sans-serif;max-width:600px">
  <h2>New callback request</h2>
  <p>A new callback request has been received.</p>
  <dl>${htmlRows
    .map(([label, value]) => `<dt><strong>${escapeHtml(label)}</strong></dt><dd>${escapeHtml(value)}</dd>`)
    .join("")}</dl>
  <p><a href="${DASHBOARD_CALLBACK_REQUESTS_URL}">Review and manage this request</a></p>
</div>`;

  return { subject, text: lines.join("\n"), html };
};

const resolveRecipients = async (companyId) => {
  const memberships = await CompanyMembership.find({
    companyId,
    status: "active",
    role: { $in: ["owner", "admin"] },
  })
    .select("userId")
    .populate({ path: "userId", select: "email" })
    .lean();

  const recipients = [];
  const seen = new Set();

  for (const membership of memberships || []) {
    const email = normalizeEmail(
      typeof membership.userId === "object"
        ? membership.userId?.email
        : "",
    );
    if (isUsableEmail(email) && !seen.has(email)) {
      seen.add(email);
      recipients.push(email);
    }
  }

  return recipients;
};

const getFailureCode = (error) => {
  const code = String(error?.code || "").trim();
  if (/^EMAIL_[A-Z0-9_]+$/.test(code)) return code;
  if (error?.name === "AbortError") return "EMAIL_TIMEOUT";
  return "EMAIL_DELIVERY_FAILED";
};

const updateDeliveryState = async (request, update, unset = {}) => {
  await ReservationStaffRequest.updateOne(
    {
      _id: request._id,
      companyId: request.companyId,
      type: "callback",
    },
    {
      $set: update,
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    },
  );
};

export const notifyReservationCallbackCreated = async (request, { send = sendEmail } = {}) => {
  const requestId = String(request?._id || "");
  const companyId = request?.companyId;

  if (!requestId || !companyId || request?.type !== "callback") {
    return { status: "ignored" };
  }

  try {
    let callbackNotifications = null;
    try {
      callbackNotifications = await getReservationCallbackNotificationSettings(
        request.reservationBusinessId,
      );
    } catch (error) {
      console.warn("[Reservations callback notification preference lookup failed]", {
        requestId,
        companyId: String(companyId),
        status: "fallback_owner_admin",
      });
    }

    if (callbackNotifications?.enabled === false) {
      await updateDeliveryState(request, {
        "notification.email.status": "disabled",
        "notification.email.lastAttemptAt": new Date(),
      });
      return { status: "disabled" };
    }

    const existingStatus = request?.notification?.email?.status;
    if (existingStatus === "sent") {
      return { status: "already_sent" };
    }

    const recipients = await resolveRecipients(companyId);
    if (!recipients.length) {
      await updateDeliveryState(request, {
        "notification.email.status": "no_recipients",
        "notification.email.lastAttemptAt": new Date(),
      });
      console.warn("[Reservations callback notification unavailable]", {
        requestId,
        companyId: String(companyId),
        recipientCount: 0,
        status: "no_recipients",
      });
      return { status: "no_recipients" };
    }

    const retryBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);
    const claimToken = crypto.randomUUID();
    const claimed = await ReservationStaffRequest.findOneAndUpdate(
      {
        _id: request._id,
        companyId,
        type: "callback",
        $or: [
          { "notification.email.status": { $exists: false } },
          {
            "notification.email.status": "not_attempted",
            $or: [
              { "notification.email.claimedAt": { $exists: false } },
              { "notification.email.claimedAt": null },
              { "notification.email.claimedAt": { $lt: retryBefore } },
            ],
          },
          {
            "notification.email.status": "failed",
            $or: [
              { "notification.email.claimedAt": { $exists: false } },
              { "notification.email.claimedAt": null },
              { "notification.email.claimedAt": { $lt: retryBefore } },
            ],
          },
        ],
      },
      {
        $set: {
          "notification.email.status": "not_attempted",
          "notification.email.lastAttemptAt": new Date(),
          "notification.email.claimedAt": new Date(),
          "notification.email.claimToken": claimToken,
        },
        $inc: { "notification.email.attempts": 1 },
      },
      { new: true },
    );

    if (
      !claimed ||
      claimed.notification?.email?.claimToken !== claimToken
    ) {
      return {
        status: existingStatus === "sent" ? "already_sent" : "in_flight",
      };
    }

    try {
      const payload = getEmailPayload(request);
      const responses = [];
      for (const recipient of recipients) {
        responses.push(
          await send({
            to: recipient,
            subject: payload.subject,
            text: payload.text,
            html: payload.html,
          }),
        );
      }
      const providerMessageId = responses
        .map((response) => response?.id || response?.data?.id || "")
        .filter(Boolean)
        .join(",")
        .slice(0, MAX_EMAIL_FIELD_LENGTH);
      await updateDeliveryState(
        request,
        {
          "notification.email.status": "sent",
          "notification.email.sentAt": new Date(),
          "notification.email.lastAttemptAt": new Date(),
          "notification.email.providerMessageId": String(providerMessageId),
        },
        {
          "notification.email.claimedAt": "",
          "notification.email.claimToken": "",
        },
      );
      console.info("[Reservations callback notification sent]", {
        requestId,
        companyId: String(companyId),
        recipientCount: recipients.length,
        status: "sent",
      });
      return { status: "sent", recipientCount: recipients.length };
    } catch (error) {
      const failureCode = getFailureCode(error);
      await updateDeliveryState(
        request,
        {
          "notification.email.status": "failed",
          "notification.email.lastAttemptAt": new Date(),
          "notification.email.failureCode": failureCode,
        },
        {
          "notification.email.claimedAt": "",
          "notification.email.claimToken": "",
        },
      );
      console.warn("[Reservations callback notification failed]", {
        requestId,
        companyId: String(companyId),
        recipientCount: recipients.length,
        status: "failed",
        failureCode,
      });
      return { status: "failed", failureCode };
    }
  } catch (error) {
    const failureCode = getFailureCode(error);
    try {
      await updateDeliveryState(
        request,
        {
          "notification.email.status": "failed",
          "notification.email.lastAttemptAt": new Date(),
          "notification.email.failureCode": failureCode,
        },
        {
          "notification.email.claimedAt": "",
          "notification.email.claimToken": "",
        },
      );
    } catch (stateError) {
      console.warn("[Reservations callback notification state update failed]", {
        requestId,
        companyId: String(companyId),
        status: "failed",
      });
    }
    console.warn("[Reservations callback notification failed]", {
      requestId,
      companyId: String(companyId),
      status: "failed",
      failureCode,
    });
    return { status: "failed", failureCode };
  }
};

export { DASHBOARD_CALLBACK_REQUESTS_URL, getEmailPayload, resolveRecipients };
