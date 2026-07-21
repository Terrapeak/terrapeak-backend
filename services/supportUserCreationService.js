import crypto from "crypto";
import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import User from "../models/user.js";
import { issueInvitation } from "./userLifecycleService.js";

const CONFIRM_WORDS = /^(confirm|confirmed|yes|yes please|proceed|go ahead|do it)$/i;
const CANCEL_WORDS = /^(cancel|no|stop|do not proceed|don't proceed)$/i;
const ADD_USER_WORDS = /\b(add