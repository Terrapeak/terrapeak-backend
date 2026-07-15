import asyncHandler from "express-async-handler";

import App from "../models/app.js";
import onboardCustomerEnvironment from "../services/customerOnboardingService.js";

const slugify = (text = "") =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const makeReferencePrefix = (companyName = "") =>
  companyName
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 5);

export const getPlatformOnboardingOptions = asyncHandler