import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { logReservationsOperation } from "./reservationsOperationalLog.js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const isMissingValue = (value) =>
  value === undefined || value === null || value === "";

export const getMissingReservationFieldValues = (existing, defaults) =>
  Object.fromEntries(
    Object.entries(defaults).filter(
      ([key, value]) => key !== "business_id" && isMissingValue(existing?.[key]) && !isMissingValue(value)
    )
  );

const findByBusinessId = async (table, businessId) => {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load ${table}`);
  }

  return data || null;
};

export async function findReservationBusinessBySlug(businessSlug) {
  if (!businessSlug) return null;

  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("business_slug", businessSlug)
    .maybeSingle();

  if (error) {
    throw new Error("Could not load reservation business");
  }

  return data || null;
}

export async function getReservationProvisioningRecords(businessId) {
  if (!businessId) {
    return { profile: null, settings: null, branding: null, service: null };
  }

  const [profile, settings, branding, serviceResult] = await Promise.all([
    findByBusinessId("business_profile", businessId),
    findByBusinessId("restaurant_settings", businessId),
    findByBusinessId("restaurant_branding", businessId),
    supabase
      .from("services")
      .select("*")
      .eq("business_id", businessId)
      .eq("booking_type", "restaurant")
      .eq("is_active", true)
      .eq("is_published", true)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (serviceResult.error) {
    throw new Error("Could not load canonical restaurant service");
  }

  return { profile, settings, branding, service: serviceResult.data || null };
}

export async function getCanonicalReservationsReadiness(businessId) {
  const numericBusinessId = Number(businessId);
  if (!Number.isFinite(numericBusinessId) || numericBusinessId <= 0) {
    return { ready: false, reason: "missing-business-mapping" };
  }

  const [{ data: business, error: businessError }, records] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, booking_model_version")
      .eq("id", numericBusinessId)
      .maybeSingle(),
    getReservationProvisioningRecords(numericBusinessId),
  ]);

  if (businessError) {
    throw new Error("Could not verify canonical Reservations readiness");
  }

  if (!business) return { ready: false, reason: "business-not-found" };
  if (Number(business.booking_model_version || 1) < 2) {
    return { ready: false, reason: "canonical-model-not-active" };
  }
  if (!records.profile || !records.settings?.timezone || !records.branding) {
    return { ready: false, reason: "provisioning-incomplete" };
  }
  return { ready: true, reason: null };
}

export async function getBusinessBySlug(businessSlug) {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("business_slug", businessSlug)
    .single();

  if (error) {
    throw new Error("Business not found");
  }

  return data;
}

export async function checkReservationAvailability({
  businessId,
  reservationDate,
  reservationTime,
  partySize,
  excludeReservationId = null,
}) {
  const { data, error } = await supabase.rpc(
    "check_canonical_restaurant_availability",
    {
      p_business_id: businessId,
      p_local_date: reservationDate,
      p_local_time: reservationTime,
      p_quantity: Number(partySize),
      p_exclude_booking_id: excludeReservationId || null,
    },
  );

  if (error) {
    console.error("Canonical reservation availability error:", error);
    throw new Error("Could not check reservation availability");
  }

  return data === true;
}

export async function generateReservationReference({
  businessId: _businessId,
  reservationDate: _reservationDate,
}) {
  return `BK-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

const getCanonicalRestaurantContext = async (businessId) => {
  const [
    { data: business, error: businessError },
    { data: settings, error: settingsError },
    { data: service, error: serviceError },
  ] = await Promise.all([
      supabase
        .from("businesses")
        .select("id, business_slug, booking_model_version")
        .eq("id", businessId)
        .eq("booking_model_version", 2)
        .maybeSingle(),
      supabase
        .from("restaurant_settings")
        .select("timezone")
        .eq("business_id", businessId)
        .maybeSingle(),
      supabase
        .from("services")
        .select("id")
        .eq("business_id", businessId)
        .eq("booking_type", "restaurant")
        .eq("is_active", true)
        .eq("is_published", true)
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  if (businessError || settingsError || serviceError) {
    console.error("Canonical restaurant context error:", {
      businessError,
      settingsError,
      serviceError,
    });
    throw new Error("Could not load reservation configuration");
  }

  if (!business || !settings?.timezone || !service) {
    throw new Error("Reservations are not configured for this business.");
  }

  return { ...business, timezone: settings.timezone, serviceId: service.id };
};

export const normalizeCanonicalRestaurantBooking = (booking, timezone) => {
  if (!booking) return null;

  const localStart = DateTime.fromISO(booking.starts_at, { setZone: true }).setZone(
    timezone,
  );

  if (!localStart.isValid) {
    throw new Error("Booking has an invalid start timestamp");
  }

  return {
    ...booking,
    reservation_reference: booking.reference,
    phone: booking.customer_phone,
    reservation_date: localStart.toISODate(),
    reservation_time: localStart.toFormat("HH:mm:ss"),
    party_size: Number(booking.quantity),
