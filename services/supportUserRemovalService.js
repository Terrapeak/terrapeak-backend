import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";

const CONFIRM = /^(confirm|confirmed|yes|yes please|proceed|go ahead|do it)$/i;
const CANCEL = /^(cancel|no|stop|do not proceed|don't proceed)$/i;
const REQUEST = /\b(deactivate|disable|remove|delete)\b[\s\S]{0,80}\b(user|member|employee|colleague|account)\b|\b(user|member|employee|colleague|account)\b[\s\S]{0,80}\b(deactivate|disable|remove|delete)\b/i;
const