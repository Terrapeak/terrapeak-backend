import { createClient } from "@supabase/supabase-js";

import { getReservationsTemplate } from "../config/reservationsTemplates.js";
import { applyReservationTemplateServiceDefaults } from "./reservationTemplateServiceDefaults.js";

const getSupabase = () =>
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function applyReservationsTemplate({ businessId, templateKey }) {
  const supabase = getSupabase();
  const template = getReservationsTemplate(templateKey);
  const { data: existing = [], error: loadError } = await supabase
    .from("booking_custom_fields")
    .select("id,field_label,system_key,is_active")
    .eq("business_id", businessId);

  if (loadError) throw new Error("Could not load Customer Form fields for template provisioning.");

  const systemFields = [
    { field_label: "Full name", field_type: "text", is_required: true, is_locked: true, system_key: "customer_name" },
    { field_label: "Phone", field_type: "text", is_required: true, is_locked: true, system_key: "customer_phone" },
    { field_label: "Email", field_type: "text", is_required: false, is_locked: false, system_key: "customer_email" },
  ];
  const templateFields = template.fields.map(([label, type, options, required]) => ({
    field_label: label,
    field_type: type,
    field_options: Array.isArray(options) ? options.join("\n") : null,
    is_required: required,
    is_locked: false,
    system_key: null,
  }));
  const defaults = [...systemFields, ...templateFields];
  const desiredLabels = new Set(defaults.map((field) => field.field_label.toLowerCase()));
  const existingByLabel = new Map(
    existing.map((field) => [String(field.field_label || "").trim().toLowerCase(), field]),
  );

  const missing = defaults
    .filter((field) => !existingByLabel.has(field.field_label.toLowerCase()))
    .map((field, index) => ({
      business_id: businessId,
      ...field,
      display_order: (existing.length + index + 1) * 10,
      is_active: true,
    }));

  if (missing.length) {
    const { error } = await supabase.from("booking_custom_fields").insert(missing);
    if (error) throw new Error("Could not apply Customer Form template.");
  }

  const desiredExistingIds = existing
    .filter((field) => desiredLabels.has(String(field.field_label || "").trim().toLowerCase()))
    .map((field) => field.id);
  if (desiredExistingIds.length) {
    const { error } = await supabase
      .from("booking_custom_fields")
      .update({ is_active: true })
      .in("id", desiredExistingIds)
      .eq("business_id", businessId);
    if (error) throw new Error("Could not activate Customer Form template fields.");
  }

  const staleTemplateIds = existing
    .filter((field) => !field.system_key && !desiredLabels.has(String(field.field_label || "").trim().toLowerCase()))
    .map((field) => field.id);
  if (staleTemplateIds.length) {
    const { error } = await supabase
      .from("booking_custom_fields")
      .update({ is_active: false })
      .in("id", staleTemplateIds)
      .eq("business_id", businessId);
    if (error) throw new Error("Could not retire stale Customer Form template fields.");
  }

  const serviceDefaults = await applyReservationTemplateServiceDefaults({
    businessId,
    templateKey,
  });

  return {
    templateKey,
    businessType: template.businessType,
    addedFields: missing.length,
    preservedFields: existing.length,
    retiredFields: staleTemplateIds.length,
    service: serviceDefaults.service,
  };
}
