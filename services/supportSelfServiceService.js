import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import CompanyMembership from "../models/companyMembership.js";

const ACTION_WORDS = /\b(change|update|edit|add|remove|delete|disable|enable|resend|reset|cancel|upgrade|downgrade|replace|modify|invite|create)\b/i;
const BILLING_WORDS = /\b(plan|billing|subscription|renewal|contract|trial|payment|credits?|allowance|usage)\b/i;
const COMPANY_WORDS = /\b(company|address|website|phone|country|contact details?|company email|company name)\b/i;
const USER_WORDS = /\b