import nodemailer from "nodemailer";

const APP_NAME = process.env.APP_NAME || "Terrapeak";
const REQUEST_TIMEOUT_MS = 12000;

const getSenderEmail = () =>
  process.env.EMAIL_FROM ||
  process.env.EMAIL_USER ||
  "noreply@terrapeakgroup.com";

const getSender = () => `"${APP_NAME}" <${getSenderEmail()}>`;

const sendWithResend = async ({ to, subject, text, html }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: getSender(),
        to: [to],
        subject,
        text,
        html,
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        payload?.message || `Resend rejected the email with status ${response.status}.`
      );
      error.code = "EMAIL_PROVIDER_ERROR";
      throw error;
    }

    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Email delivery timed out after 12 seconds.");
      timeoutError.code = "EMAIL_TIMEOUT";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const sendWithSmtp = async ({ to, subject, text, html }) => {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    const error = new Error(
      "Email delivery is not configured. Set RESEND_API_KEY or EMAIL_USER and EMAIL_PASS."
    );
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: Number(process.env.EMAIL_PORT || 587),
    secure: String(process.env.EMAIL_SECURE || "false") === "true",
    requireTLS: String(process.env.EMAIL_REQUIRE_TLS || "true") === "true",
    auth: { user, pass },
    connectionTimeout: REQUEST_TIMEOUT_MS,
    greetingTimeout: REQUEST_TIMEOUT_MS,
    socketTimeout: REQUEST_TIMEOUT_MS,
  });

  try {
    return await transporter.sendMail({
      from: getSender(),
      to,
      subject,
      text,
      html,
    });
  } catch (error) {
    const deliveryError = new Error(
      error?.code === "EAUTH"
        ? "Email authentication failed. Check the configured email account and app password."
        : error?.code === "ETIMEDOUT" || error?.code === "ESOCKET"
          ? "The email provider could not be reached from Railway. Configure RESEND_API_KEY for HTTPS delivery."
          : error?.message || "Email delivery failed."
    );
    deliveryError.code = error?.code || "EMAIL_DELIVERY_FAILED";
    throw deliveryError;
  } finally {
    transporter.close();
  }
};

const sendEmail = async ({ to, subject, text, html }) => {
  if (!to) {
    const error = new Error("An email recipient is required.");
    error.code = "EMAIL_RECIPIENT_REQUIRED";
    throw error;
  }

  if (process.env.RESEND_API_KEY) {
    return sendWithResend({ to, subject, text, html });
  }

  return sendWithSmtp({ to, subject, text, html });
};

export default sendEmail;
