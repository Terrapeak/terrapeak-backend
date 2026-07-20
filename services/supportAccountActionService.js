import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";
import { issueInvitation, issuePasswordReset } from "./userLifecycleService.js";

const CONFIRM_WORDS = /^(confirm|confirmed|yes|yes please|proceed|go ahead|do it)$/i;
const CANCEL_WORDS = /^(cancel|no|stop|do not proceed|don't proceed)$/i;
const RESEND_INVITE_WORDS = /\b(resend|send again|new)\b[\s\S]{0,35