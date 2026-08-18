import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? "" : String(args[index + 1] || "").trim();
};

const businessId = Number(valueFor("--business-id"));
const apply = args.includes("--apply");
const confirmedSlug = valueFor("--confirm-slug");

if (!Number.isInteger(businessId) || businessId <= 0) {
  throw new Error("Usage: --business-id <positive integer> [--apply --confirm-slug <exact-slug>]");
}
if (apply && !confirmedSlug) {
  throw new Error("Apply requires --confirm-slug with the exact business slug from the dry run.");
}

const url = String(process.env.SUPABASE_URL || "").trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!url || !serviceRoleKey) throw new Error("Supabase admin credentials are required.");

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const run = async (shouldApply) => {
  const { data, error } = await supabase.rpc("migrate_legacy_reservations_business", {
    p_business_id: businessId,
    p_apply: shouldApply,
  });
  if (error) throw new Error(error.message || "Reservations migration RPC failed");
  return data;
};

const dryRun = await run(false);
console.log(JSON.stringify({ phase: "dry-run", result: dryRun }, null, 2));

if (!dryRun?.ready) throw new Error("Tenant did not pass migration readiness checks.");
if (!apply) process.exit(0);
if (String(dryRun.business_slug) !== confirmedSlug) {
  throw new Error("--confirm-slug does not match the live tenant selected by --business-id.");
}

const result = await run(true);
console.log(JSON.stringify({ phase: "applied", result }, null, 2));
