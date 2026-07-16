import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import CompanyAppInstallation from "../models/companyAppInstallation.js";
import ChatbotSettings from "../models/chatbotSettings.js";
import Session from "../models/sessionModel.js";

const HEALTHY_BILLING_STATUSES = new Set(["trial", "active", "manual"]);
const DATA_QUALITY_DEDUCTION_CAP = 10;
