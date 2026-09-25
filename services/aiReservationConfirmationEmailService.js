import { randomUUID } from "node:crypto";
import ReservationBookingAttempt from "../models/reservationBookingAttempt.js";
import sendEmail from "../utils/sendEmail.js";

const safeText = (value, fallback = "Not provided") => value === undefined || value === null || value === "" ? fallback : String(value);
const htmlEscape = (value) => safeText(value).replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[character]));

const buildEmailContent = ({ summary = {}, result = {} }) => {
  const reference = result.reference || result.bookingReference;
  if (!reference) {
    const error = new Error("The authoritative booking reference is unavailable.");
    error.code = "BOOKING_REFERENCE_MISSING";
    throw error;
  }
  const customFields = Array.isArray(summary.customFields) && summary.customFields.length
    ? `\n\nAdditional details:\n${summary.customFields.map((field) => `${safeText(field.label)}: ${safeText(field.value)}`).join("\n")}`
    : "";
  const isRestaurant = summary.journeyType === "restaurant";
  const isScheduledSession = summary.journeyType === "scheduled_session";
  const time = `${safeText(summary.localTime)}${summary.timezone ? ` (${summary.timezone})` : ""}`;
  const lines = isScheduledSession
    ? ["Class registration confirmed", "", `Reference: ${safeText(reference)}`, `Class: ${safeText(summary.serviceName)}`, `Date: ${safeText(summary.localDate)}`, `Time: ${time}`, `Teacher: ${safeText(summary.teacherName)}`, `Student: ${safeText(summary.customFields?.find((field) => field.fieldKey === "student_name")?.value)}`, `Contact: ${safeText(summary.customer?.name)}`, customFields]
    : isRestaurant
    ? ["Reservation confirmed", "", `Reference: ${safeText(reference)}`, `Date: ${safeText(summary.localDate)}`, `Time: ${time}`, `Guests: ${safeText(summary.quantity)}`, `Customer: ${safeText(summary.customer?.name)}`, customFields]
    : ["Appointment confirmed", "", `Reference: ${safeText(reference)}`, `Service: ${safeText(summary.serviceName)}`, `Provider: ${safeText(summary.providerName)}`, `Date: ${safeText(summary.localDate)}`, `Time: ${time}`, `Customer: ${safeText(summary.customer?.name)}`, customFields];
  const text = lines.join("\n");
  const html = text.split("\n").map((line) => line ? `<div>${htmlEscape(line)}</div>` : "<br>").join("");
  return { reference: String(reference), subject: `${isScheduledSession ? "Class registration" : isRestaurant ? "Reservation" : "Appointment"} confirmed — ${String(summary.serviceName || "Terrapeak Reservations")}`, text, html };
};

export async function sendAiReservationConfirmationEmail({ context, bookingAttemptId, summary, result, model = ReservationBookingAttempt, send = sendEmail } = {}) {
  const recipient = String(summary?.customer?.email || "").trim();
  if (!recipient) return { status: "not_attempted", reason: "recipient_missing" };
  const claimToken = randomUUID();
  const claimed = await model.findOneAndUpdate(
    { companyId: context.companyId, chatbotId: context.chatbotId, sessionId: context.sessionId, bookingAttemptId, status: "completed", $or: [{ "notification.email.status": { $exists: false } }, { "notification.email.status": "not_attempted" }] },
    { $set: { "notification.email.status": "sending", "notification.email.claimToken": claimToken, "notification.email.claimedAt": new Date(), "notification.email.lastAttemptAt": new Date(), "notification.email.failureCode": null }, $inc: { "notification.email.attempts": 1 } },
    { new: true },
  );
  if (!claimed || claimed.notification?.email?.claimToken !== claimToken) return { status: "not_attempted", reason: "already_claimed" };
  try {
    const content = buildEmailContent({ summary, result });
    const providerResponse = await send({ to: recipient, subject: content.subject, text: content.text, html: content.html });
    const providerMessageId = providerResponse?.id || providerResponse?.data?.id || null;
    await model.findOneAndUpdate({ _id: claimed._id, "notification.email.claimToken": claimToken }, { $set: { "notification.email.status": "sent", "notification.email.sentAt": new Date(), "notification.email.providerMessageId": providerMessageId, "notification.email.claimToken": null, "notification.email.claimedAt": null } }, { new: true });
    return { status: "sent", providerMessageId };
  } catch (error) {
    await model.findOneAndUpdate({ _id: claimed._id, "notification.email.claimToken": claimToken }, { $set: { "notification.email.status": "failed", "notification.email.failureCode": error.code || "EMAIL_DELIVERY_FAILED", "notification.email.claimToken": null, "notification.email.claimedAt": null } }, { new: true });
    return { status: "failed", failureCode: error.code || "EMAIL_DELIVERY_FAILED" };
  }
}

export { buildEmailContent };
