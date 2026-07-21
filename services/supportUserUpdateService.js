import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";

const CONFIRM = /^(confirm|confirmed|yes|yes please|proceed|go ahead|do it)$/i;
const CANCEL = /^(cancel|no|stop|do not proceed|don't proceed)$/i;
const UPDATE_USER = /\b(change|update|edit|set|reactivate)\b[\s\S]{0,50}\b(user|member|employee|colleague|role|phone|country|name|membership)\b|\b(user|member|employee|colleague)\b[\s\S]{0,50}\b(change|update|edit|set|reactivate)\b/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const