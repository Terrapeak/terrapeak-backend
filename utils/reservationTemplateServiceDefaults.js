import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { getReservationTemplateServiceDefaults } from "./reservationTemplateDefaults.js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function applyReservationTemplateServiceDefaults({ businessId, templateKey }) {
  const defaults = getReservationTemplateServiceDefaults(templateKey);

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .update({ business_type: defaults.businessType })
    .eq("id", businessId)
    .select()
    .single();
  if (businessError) throw new Error("Could not apply Reservations business template");

  const { data: profile, error: profileError } = await supabase
    .from("business_profile")
    .update({
      business_type: defaults.businessType,
      industry_template: defaults.businessType,
      booking_label: defaults.businessType === "restaurant" ? "Reservation" : "Appointment",
      capacity_label: defaults.businessType === "restaurant" ? "Guests" : "People",
      uses_capacity: defaults.businessType === "restaurant",
    })
    .eq("business_id", businessId)
    .select()
    .maybeSingle();
  if (profileError) throw new Error("Could not apply Reservations profile template");

  const { data: service, error: serviceError } = await supabase
    .from("services")
    .update({
      name: defaults.name,
      slug: defaults.slug,
      description: defaults.description,
      duration_minutes: defaults.durationMinutes,
      capacity: defaults.businessType === "restaurant" ? 20 : 1,
    })
    .eq("business_id", businessId)
    .eq("booking_type", "restaurant")
    .eq("is_active", true)
    .select()
    .maybeSingle();
  if (serviceError) throw new Error("Could not apply Reservations service template");

  return { business, profile, service };
}
