import { createClient } from "@supabase/supabase-js";

import { getReservationsTemplate } from "../config/reservationsTemplates.js";

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

  const existingLabels = new Set(
    existing.map((field) => String(field.field_label || "").trim().toLowerCase()),
  );
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
  const missing = defaults
    .filter((field) => !existingLabels.has(field.field_label.toLowerCase()))
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

  return {
    templateKey,
    businessType: template.businessType,
    addedFields: missing.length,
    preservedFields: existing.length,
  };
}
