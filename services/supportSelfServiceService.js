import Company from "../models/company.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";

const ACTION_WORDS = /\b(change|update|edit|add|remove|delete|disable|enable|resend|reset|cancel|upgrade|downgrade|replace|modify|invite|create)\b/i;

const formatDate = (value) => {
  if (!value) return "not configured";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",