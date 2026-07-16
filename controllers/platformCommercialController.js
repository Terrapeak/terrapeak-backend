import asyncHandler from "express-async-handler";

import Company from "../models/company.js";
import Contract from "../models/contract.js";

const PLANS = new Set(["starter", "growth", "professional", "enterprise"]);
const BILLING_STATUSES = new Set(["not_configured", "trial", "active", "past_due", "cancelled", "manual"]);
const PAYMENT_STATUSES = new Set(["not_configured", "paid", "unpaid", "past