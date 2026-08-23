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

  // A partially completed onboarding can be retried after the template has already
  // changed the canonical service slug away from `restaurant-reservation`. Older
  // provisioning code could then create a second active restaurant service. Never
  // bulk-update all matching rows with maybeSingle(): resolve one canonical service
  // deterministically and update it by id instead.
  const { data: canonicalService, error: canonicalServiceError } = await supabase
    .from("services")
    .select("id")
    .eq("business_id", businessId)
    .eq("booking_type", "restaurant")
    .eq("is_active", true)
    .order("is_published", { ascending: false })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (canonicalServiceError) {
    throw new Error("Could not resolve Reservations service template");
  }

  let service = null;

  if (canonicalService?.id) {
    const { data: updatedService, error: serviceError } = await supabase
      .from("services")
      .update({
        name: defaults.name,
        slug: defaults.slug,
        description: defaults.description,
        duration_minutes: defaults.durationMinutes,
        capacity: defaults.businessType === "restaurant" ? 20 : 1,
      })
      .eq("id", canonicalService.id)
      .eq("business_id", businessId)
      .select()
      .single();

    if (serviceError) throw new Error("Could not apply Reservations service template");
    service = updatedService;
  }

  return { business, profile, service };
}
