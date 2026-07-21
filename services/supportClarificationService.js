import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";

const PHONE = /\+?\d[\d\s().-]{5,30}\d/;
const TTL = 15 * 60 * 1000;
const reply = (body) => ({ handled: true, body });
const firstName = (user) => String(user?.name || "").trim().split(/\s+/)[0] || "there";

const isAmbiguousPhoneRequest = (text) => {
  const hasChange = /\b(change|update|edit|set)\b/i.test(text);
  const has