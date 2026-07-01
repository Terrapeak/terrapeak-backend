import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  const { data: settings, error: settingsError } = await supabase
    .from("restaurant_settings")
    .select("*")
    .eq("business_id", businessId)
    .single();

  if (settingsError || !settings) {
    console.error("Reservation settings error:", settingsError);
    throw new Error("Could not load reservation settings");
  }

  const timeToMinutes = (time) => {
    if (!time || typeof time !== "string") return null;

    const cleanTime = time.slice(0, 5);
    const [hours, minutes] = cleanTime.split(":").map(Number);

    if (
      Number.isNaN(hours) ||
      Number.isNaN(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }

    return hours * 60 + minutes;
  };

  const requestedTime = timeToMinutes(reservationTime);
  const openingTime = timeToMinutes(settings.opening_time);
  const closingTime = timeToMinutes(settings.closing_time);

  if (requestedTime === null || openingTime === null || closingTime === null) {
    console.error("Invalid reservation/settings time:", {
      reservationTime,
      opening_time: settings.opening_time,
      closing_time: settings.closing_time,
    });

    return false;
  }

  if (requestedTime < openingTime || requestedTime >= closingTime) {
    return false;
  }

  let query = supabase
    .from("reservations")
    .select("*")
    .eq("business_id", businessId)
    .eq("reservation_date", reservationDate)
    .eq("reservation_time", reservationTime)
    .eq("status", "confirmed");

  if (excludeReservationId) {
    query = query.neq("id", String(excludeReservationId));
  }

  const { data: reservations, error } = await query;

  if (error) {
    console.error("Reservation availability query error:", error);
    throw new Error("Could not check reservation availability");
  }

  const currentGuests = (reservations || []).reduce(
    (total, reservation) => total + Number(reservation.party_size || 0),
    0
  );

  return currentGuests + Number(partySize) <= Number(settings.max_guests_per_slot);
}

export async function generateReservationReference({
  businessId,
  reservationDate,
}) {
  const dateCode = reservationDate.replaceAll("-", "");

  const { data: profile, error: profileError } = await supabase
    .from("business_profile")
    .select("reference_prefix")
    .eq("business_id", businessId)
    .single();

  if (profileError) {
    throw new Error("Could not load business profile");
  }

  const prefix = profile?.reference_prefix || "BOT";

  const { data, error } = await supabase
    .from("reservations")
    .select("id")
    .eq("business_id", businessId)
    .eq("reservation_date", reservationDate);

  if (error) {
    throw new Error("Could not generate reservation reference");
  }

  const nextNumber = (data?.length || 0) + 1;
  const paddedNumber = String(nextNumber).padStart(3, "0");

  return `${prefix}-${dateCode}-${paddedNumber}`;
}

export async function createReservation({
  businessId,
  customerName,
  phone,
  reservationDate,
  reservationTime,
  partySize,
  specialRequest = "",
  customData = {},
}) {

  const reservationReference = await generateReservationReference({
    businessId,
    reservationDate,
  });

  const { data, error } = await supabase
    .from("reservations")
    .insert([
      {
        business_id: businessId,
        customer_name: customerName,
        phone,
        reservation_date: reservationDate,
        reservation_time: reservationTime,
        party_size: Number(partySize),
        special_request: specialRequest,
        reservation_reference: reservationReference,
        status: "confirmed",
        is_archived: false,
        custom_data: customData,
      },
    ])
    .select()
    .single();

  if (error) {
    throw new Error("Could not create reservation");
  }

  return data;
}

export async function findActiveReservationsByReference({
  businessId,
  reservationReference,
}) {
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("business_id", businessId)
    .eq("reservation_reference", reservationReference)
    .eq("status", "confirmed")
    .order("reservation_date", { ascending: true })
    .order("reservation_time", { ascending: true });

  if (error) {
    throw new Error("Could not search reservation by reference");
  }

  return data || [];
}

export async function findActiveReservationsByPhone({
  businessId,
  phone,
}) {
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .eq("status", "confirmed")
    .order("reservation_date", { ascending: true })
    .order("reservation_time", { ascending: true });

  if (error) {
    throw new Error("Could not search reservations by phone");
  }

  return data || [];
}

export async function cancelReservationById({
  businessId,
  reservationId,
}) {
  const { data, error } = await supabase
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("business_id", businessId)
    .eq("id", reservationId)
    .eq("status", "confirmed")
    .select()
    .single();

  if (error) {
    throw new Error("Could not cancel reservation");
  }

  return data;
}

export async function updateReservationById({
  businessId,
  reservationId,
  reservationDate,
  reservationTime,
  partySize,
  specialRequest,
  customData = {},
}) {

  const { data, error } = await supabase
    .from("reservations")
    .update({
  reservation_date: reservationDate,
  reservation_time: reservationTime,
  party_size: Number(partySize),
  special_request: specialRequest,
  custom_data: customData,
})
    .eq("business_id", businessId)
    .eq("id", reservationId)
    .eq("status", "confirmed")
    .select()
    .single();

  if (error) {
    throw new Error("Could not update reservation");
  }

  return data;
}

export async function createOrGetReservationBusiness({
  businessName,
  businessSlug,
  businessType = "restaurant",
}) {
  const { data: existingBusiness } = await supabase
    .from("businesses")
    .select("*")
    .eq("business_slug", businessSlug)
    .maybeSingle();

  if (existingBusiness) {
    return existingBusiness;
  }

  const { data, error } = await supabase
    .from("businesses")
    .insert([
      {
        business_name: businessName,
        business_slug: businessSlug,
        business_type: businessType,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Create reservation business error:", error);
    throw new Error("Could not create reservation business");
  }

  return data;
}

export async function createOrUpdateBusinessProfile({
  businessId,
  businessName,
  businessType = "restaurant",
  referencePrefix = "BOT",
}) {
  const profileData = {
    business_id: businessId,
    business_name: businessName,
    business_type: businessType,
    booking_label: "Reservation",
    customer_label: "Customer",
    capacity_label: "Guests",
    industry_template: businessType,
    uses_capacity: true,
    reference_prefix: referencePrefix,
  };

  const { data: existingProfile } = await supabase
    .from("business_profile")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (existingProfile) {
    const { data, error } = await supabase
      .from("business_profile")
      .update(profileData)
      .eq("business_id", businessId)
      .select()
      .single();

    if (error) {
      console.error("Update business profile error:", error);
      throw new Error("Could not update business profile");
    }

    return data;
  }

  const { data, error } = await supabase
    .from("business_profile")
    .insert([profileData])
    .select()
    .single();

  if (error) {
    console.error("Create business profile error:", error);
    throw new Error("Could not create business profile");
  }

  return data;
}

export async function createOrUpdateRestaurantSettings({ businessId }) {
  const settingsData = {
  business_id: businessId,
  opening_time: "11:00:00",
  closing_time: "22:00:00",
  max_guests_per_slot: 20,
  default_duration_minutes: 90,
};

  const { data: existingSettings } = await supabase
    .from("restaurant_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (existingSettings) {
    const { data, error } = await supabase
      .from("restaurant_settings")
      .update(settingsData)
      .eq("business_id", businessId)
      .select()
      .single();

    if (error) {
      console.error("Update restaurant settings error:", error);
      throw new Error("Could not update restaurant settings");
    }

    return data;
  }

  const { data, error } = await supabase
    .from("restaurant_settings")
    .insert([settingsData])
    .select()
    .single();

  if (error) {
    console.error("Create restaurant settings error:", error);
    throw new Error("Could not create restaurant settings");
  }

  return data;
}

export async function createOrUpdateRestaurantBranding({
  businessId,
  restaurantName,
}) {
  const brandingData = {
    business_id: businessId,
    restaurant_name: restaurantName,
    primary_color: "#2563eb",
    background_start: "#eff6ff",
    background_end: "#dbeafe",
    logo_url: "",
  };

  const { data: existing } = await supabase
    .from("restaurant_branding")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("restaurant_branding")
      .update(brandingData)
      .eq("business_id", businessId)
      .select()
      .single();

    if (error) throw error;

    return data;
  }

  const { data, error } = await supabase
    .from("restaurant_branding")
    .insert([brandingData])
    .select()
    .single();

  if (error) throw error;

  return data;
}