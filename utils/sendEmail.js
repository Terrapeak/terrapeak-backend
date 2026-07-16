import nodemailer from "nodemailer";

const APP_NAME = process.env.APP_NAME || "Terrapeak";
const DEFAULT_TIMEOUT_MS = 12000;

const buildSender = () => {
  const senderEmail =
    process.env.EMAIL_FROM ||
    process.env.EMAIL_USER ||
    "noreply@terrapeakgroup.com";

  return `"${APP_NAME}" <${senderEmail}>`;
};

const sendWithResend = async ({ to, subject, text, html }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);