import { createClient } from "@supabase/supabase-js";

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
}) {
  const { data: settings, error: settingsError } = await supabase
    .from("restaurant_settings")
    .select("*")
    .eq("business_id", businessId)
    .single();

  if (settingsError) {
    throw new Error("Could not load reservation settings");
  }

  const { data: reservations, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("business_id", businessId)
    .eq("reservation_date", reservationDate)
    .eq("reservation_time", reservationTime)
    .eq("status", "confirmed");

  if (error) {
    throw new Error("Could not check reservation availability");
  }

  const currentGuests = reservations.reduce(
    (total, reservation) => total + Number(reservation.party_size || 0),
    0
  );

  return currentGuests + Number(partySize) <= settings.max_guests_per_slot;
}

export async function generateReservationReference({
  businessId,
  reservationDate,
  prefix = "BOT",
}) {
  const dateCode = reservationDate.replaceAll("-", "");

  const { data, error } = await supabase
    .from("reservations")
    .select("id")
    .eq("business_id", businessId)
    .eq("reservation_date", reservationDate);

  if (error) {
    throw new Error("Could not generate reservation reference");
  }

  const nextNumber = data.length + 1;
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
        custom_data: {},
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