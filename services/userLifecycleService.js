import crypto from "crypto";

import sendEmail from "../utils/sendEmail.js";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PRODUCTION_DASHBOARD_URL = "https://dashboard.terrapeakgroup.com";
const LEGACY_FRONTEND_HOSTS = new Set([
  "terrapeak-gemini-assistant.vercel.app",
  "terrapeak.vercel.app",
]);

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const createToken = () => crypto.randomBytes(32).toString("hex");

const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/$/, "");

const getCustomerDashboardUrl = () => {
  const explicitlyConfigured = normalizeBaseUrl(
    process.env.CUSTOMER_DASHBOARD_URL || process.env.DASHBOARD_URL,
  );

  if (explicitlyConfigured) return explicitlyConfigured;

  const legacyFrontendUrl = normalizeBaseUrl(process.env.FRONTEND_URL);

  if (legacyFrontendUrl) {
    try {
      const configuredUrl = new URL(legacyFrontendUrl);
      if (!LEGACY_FRONTEND_HOSTS.has(configuredUrl.hostname)) {
        return legacyFrontendUrl;
      }
    } catch {
      // Ignore malformed legacy values and use the safe production URL below.
    }
  }

  if (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") {
    return legacyFrontendUrl || "http://localhost:5173";
  }

  return PRODUCTION_DASHBOARD_URL;
};

export const issueInvitation = async ({ user, company, role }) => {
  const token = createToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  user.invitationStatus = "pending";
  user.invitationTokenHash = hashToken(token);
  user.invitationExpiresAt = expiresAt;
  user.invitationSentAt = new Date();
  user.accountStatus = "pending";
  await user.save();

  const setupUrl = `${getCustomerDashboardUrl()}/account/setup?mode=invite&token=${token}`;
  const companyName = company.displayName || company.name;

  await sendEmail({
    to: user.email,
    subject: `You have been invited to ${companyName} on Terrapeak`,
    text: `You have been invited to join ${companyName} as ${role}. Set your password here: ${setupUrl}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #172033;">
        <h2 style="color:#1d3e5e;">You are invited to Terrapeak</h2>
        <p>Hi <b>${user.name}</b>,</p>
        <p>You have been invited to join <b>${companyName}</b> as <b>${role}</b>.</p>
        <p>
          <a href="${setupUrl}" style="display:inline-block;background:#2f5d50;color:#ffffff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">
            Create your password
          </a>
        </p>
        <p>This invitation expires in 24 hours.</p>
      </div>
    `,
  });

  return { expiresAt };
};

export const issuePasswordReset = async ({ user }) => {
  const token = createToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  user.passwordResetTokenHash = hashToken(token);
  user.passwordResetExpiresAt = expiresAt;
  user.passwordResetSentAt = new Date();
  await user.save();

  const resetUrl = `${getCustomerDashboardUrl()}/account/setup?mode=reset&token=${token}`;

  await sendEmail({
    to: user.email,
    subject: "Reset your Terrapeak password",
    text: `Reset your Terrapeak password here: ${resetUrl}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #172033;">
        <h2 style="color:#1d3e5e;">Reset your Terrapeak password</h2>
        <p>Hi <b>${user.name}</b>,</p>
        <p>A password reset was requested for your Terrapeak account.</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;background:#2f5d50;color:#ffffff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">
            Reset password
          </a>
        </p>
        <p>This link expires in 24 hours.</p>
      </div>
    `,
  });

  return { expiresAt };
};

export const findInvitationUser = async (User, token) =>
  User.findOne({
    invitationTokenHash: hashToken(token),
    invitationExpiresAt: { $gt: new Date() },
  });

export const findPasswordResetUser = async (User, token) =>
  User.findOne({
    passwordResetTokenHash: hashToken(token),
    passwordResetExpiresAt: { $gt: new Date() },
  });
