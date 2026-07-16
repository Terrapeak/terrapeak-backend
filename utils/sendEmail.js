import nodemailer from "nodemailer";

const APP_NAME = process.env.APP_NAME || "Terrapeak";
const REQUEST_TIMEOUT_MS = 12000;

const getSenderValue = () =>
  String(
    process.env.EMAIL_FROM ||
      process.env.EMAIL_USER ||
      "noreply@terrapeakgroup.com"
  ).trim();

const getSender = () => {
  const sender = getSenderValue();

  // Allow either a plain email address or a complete formatted sender value,
  // for example: Terrapeak <onboarding@res