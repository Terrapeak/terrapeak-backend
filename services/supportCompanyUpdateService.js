import Company from "../models/company.js";

const CONFIRM_WORDS = /^(confirm|confirmed|yes|yes please|proceed|go ahead|do it)$/i;
const CANCEL_WORDS = /^(cancel|no|stop|do not proceed|don't proceed)$/i;
const UPDATE_WORDS = /\b(change|update|edit|set|replace|correct|add|use)\b/i;
const ADMIN_ROLES = new Set(["owner", "admin"]);
const ACTION_TTL_MS = 15 * 60 * 1000;
const ACTIVITY_LIMIT