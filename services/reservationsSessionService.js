import { createClient } from "@supabase/supabase-js";

const CANONICAL_RESERVATIONS_ROLES = new Set([
  "owner",
  "admin",
  "manager",
  "staff",
  "viewer",
]);

const getSupabaseAdmin = () => {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url || !serviceRoleKey) {
    const error = new Error("Reservations authentication bridge is not configured.");
    error.code = "RESERVATIONS_AUTH_NOT_CONFIGURED";
    throw error;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
};

const normalizeCompanyRole = (role) => {
  const normalized = String(role || "").trim().toLowerCase();
  if (!CANONICAL_RESERVATIONS_ROLES.has(normalized)) {
    const error = new Error("The company membership role cannot access Reservations.");
    error.code = "INVALID_RESERVATIONS_ROLE";
    throw error;
  }
  return normalized;
};

export async function createReservationsSessionBootstrap({
  email,
  terraPeakUserId,
  company,
  companyRole,
}) {
  if (!company?.reservationBusinessId) {
    const error = new Error("Reservations is not mapped to this company.");
    error.code = "RESERVATIONS_NOT_MAPPED";
    throw error;
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    const error = new Error("The TerraPeak user email is required.");
    error.code = "RESERVATIONS_USER_EMAIL_REQUIRED";
    throw error;
  }

  const normalizedRole = normalizeCompanyRole(companyRole);
  const supabase = getSupabaseAdmin();

  // GenerateLink creates the Supabase Auth user when needed but does not send
  // an email. The resulting token hash is exchanged by the Reservations client
  // for a normal short-lived Supabase session.
  const { data: linkData, error: linkError } =
    await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: normalizedEmail,
      options: {
        data: {
          terrapeak_user_id: String(terraPeakUserId || ""),
          terrapeak_company_id: String(company._id || ""),
        },
      },
    });

  if (linkError || !linkData?.user?.id || !linkData?.properties?.hashed_token) {
    const error = new Error("Could not create the Reservations session bootstrap.");
    error.code = "RESERVATIONS_SESSION_BOOTSTRAP_FAILED";
    error.cause = linkError || null;
    throw error;
  }

  const { error: membershipError } = await supabase
    .from("business_memberships")
    .upsert(
      {
        business_id: Number(company.reservationBusinessId),
        user_id: linkData.user.id,
        role: normalizedRole,
      },
      { onConflict: "business_id,user_id" },
    );

  if (membershipError) {
    const error = new Error("Could not synchronize Reservations access.");
    error.code = "RESERVATIONS_MEMBERSHIP_SYNC_FAILED";
    error.cause = membershipError;
    throw error;
  }

  return {
    tokenHash: linkData.properties.hashed_token,
    type: "email",
    businessId: Number(company.reservationBusinessId),
    businessSlug: company.reservationBusinessSlug || "",
    companyId: String(company._id),
    companyRole: normalizedRole,
    supabaseUserId: linkData.user.id,
  };
}
