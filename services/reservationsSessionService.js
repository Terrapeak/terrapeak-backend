import { createClient } from "@supabase/supabase-js";
import { logReservationsOperation } from "../utils/reservationsOperationalLog.js";

const CANONICAL_RESERVATIONS_ROLES = new Set([
  "owner",
  "admin",
  "manager",
  "staff",
  "viewer",
]);

const RESERVATIONS_COMPATIBILITY_ROLE_BY_PLATFORM_ROLE = Object.freeze({
  owner: "owner",
  admin: "manager",
  manager: "manager",
  staff: "staff",
  viewer: "viewer",
});

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
  const compatibilityRole =
    RESERVATIONS_COMPATIBILITY_ROLE_BY_PLATFORM_ROLE[normalizedRole];
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
        role: compatibilityRole,
        platform_role: normalizedRole,
      },
      { onConflict: "business_id,user_id" },
    );

  if (membershipError) {
    const error = new Error("Could not synchronize Reservations access.");
    error.code = "RESERVATIONS_MEMBERSHIP_SYNC_FAILED";
    error.cause = membershipError;
    throw error;
  }

  // Administrators can pre-assign a Reservations staff profile by the same
  // email the team member uses for TerraPeak. Linking happens here, after the
  // TerraPeak identity has been verified, so no user can claim a profile from
  // the public Reservations client.
  const { data: matchingStaff, error: staffLookupError } = await supabase
    .from("staff_members")
    .select("id,user_id")
    .eq("business_id", Number(company.reservationBusinessId))
    .ilike("login_email", normalizedEmail)
    .maybeSingle();

  if (staffLookupError) {
    const error = new Error("Could not check the Reservations staff profile link.");
    error.code = "RESERVATIONS_STAFF_LINK_LOOKUP_FAILED";
    error.cause = staffLookupError;
    throw error;
  }

  if (matchingStaff?.user_id && matchingStaff.user_id !== linkData.user.id) {
    const error = new Error("This Reservations staff profile is linked to another TerraPeak account.");
    error.code = "RESERVATIONS_STAFF_ALREADY_LINKED";
    throw error;
  }

  if (matchingStaff && !matchingStaff.user_id) {
    const { error: staffLinkError } = await supabase
      .from("staff_members")
      .update({ user_id: linkData.user.id })
      .eq("id", matchingStaff.id)
      .is("user_id", null);

    if (staffLinkError) {
      const error = new Error("Could not link the Reservations staff profile.");
      error.code = "RESERVATIONS_STAFF_LINK_FAILED";
      error.cause = staffLinkError;
      throw error;
    }
  }

  logReservationsOperation("sso.bootstrap.created", {
    companyId: company._id,
    businessId: company.reservationBusinessId,
    userId: terraPeakUserId,
    companyRole: normalizedRole,
  });

  return {
    tokenHash: linkData.properties.hashed_token,
    type: "email",
    businessId: Number(company.reservationBusinessId),
    businessSlug: company.reservationBusinessSlug || "",
    companyId: String(company._id),
    companyRole: normalizedRole,
    reservationsCompatibilityRole: compatibilityRole,
    supabaseUserId: linkData.user.id,
  };
}
