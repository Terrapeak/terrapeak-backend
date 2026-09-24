import { createClient } from "@supabase/supabase-js";

import { getReservationsTemplate } from "../config/reservationsTemplates.js";
import { applyReservationTemplateServiceDefaults } from "./reservationTemplateServiceDefaults.js";

const getSupabase = () =>
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SYSTEM_KEY_ALIASES = Object.freeze({
  customer_name: ["customer_name", "name"],
  customer_phone: ["customer_phone", "phone"],
  customer_email: ["customer_email", "email"],
});

export const buildReservationsTemplateFieldPlan = ({
  businessId,
  existing = [],
  templateKey,
  preserveExistingCustomizations = false,
}) => {
  const template = getReservationsTemplate(templateKey);
  const systemFields = [
    { field_label: "Full name", field_type: "text", is_required: true, is_locked: true, system_key: "customer_name" },
    { field_label: "Phone", field_type: "text", is_required: true, is_locked: true, system_key: "customer_phone" },
    { field_label: "Email", field_type: "text", is_required: false, is_locked: false, system_key: "customer_email" },
  ];
  const templateFields = template.fields.map(([label, type, options, required, templateFieldKey]) => ({
    field_label: label,
    field_type: type,
    field_options: Array.isArray(options) ? options.join("\n") : null,
    is_required: required,
    is_locked: false,
    system_key: null,
    field_source: "template",
    template_key: templateKey,
    template_field_key: templateFieldKey,
  }));
  const defaults = systemFields.map((field) => ({
    ...field,
    field_source: "system",
    template_key: null,
    template_field_key: null,
  })).concat(templateFields);
  const existingWithSource = existing.map((field) => ({
    ...field,
    field_source: field.field_source || (field.system_key ? "system" : "legacy"),
  }));
  const existingBySystemKey = new Map();
  existingWithSource
    .filter((field) => field.field_source === "system" && field.system_key)
    .forEach((field) => {
      existingBySystemKey.set(field.system_key, field);
      for (const [canonical, aliases] of Object.entries(SYSTEM_KEY_ALIASES)) {
        if (aliases.includes(field.system_key)) existingBySystemKey.set(canonical, field);
      }
    });
  const existingByTemplateIdentity = new Map(
    existingWithSource
      .filter((field) => field.field_source === "template" && field.template_key && field.template_field_key)
      .map((field) => [`${field.template_key}.${field.template_field_key}`, field]),
  );

  const maxDisplayOrder = existingWithSource.reduce(
    (max, field) => Math.max(max, Number(field.display_order) || 0),
    0,
  );
  const missing = defaults.filter((field) => {
    if (field.field_source === "system") return !existingBySystemKey.has(field.system_key);
    return !existingByTemplateIdentity.has(`${field.template_key}.${field.template_field_key}`);
  }).map((field, index) => ({
      business_id: businessId,
      ...field,
      display_order: maxDisplayOrder + ((index + 1) * 10),
      is_active: true,
    }));

  const targetTemplateIdentities = new Set(
    templateFields.map((field) => `${field.template_key}.${field.template_field_key}`),
  );
  const templateUpdates = templateFields
    .map((field) => existingByTemplateIdentity.get(`${field.template_key}.${field.template_field_key}`))
    .filter(Boolean)
    .map((existingField) => {
      const desired = templateFields.find(
        (field) => field.template_key === existingField.template_key
          && field.template_field_key === existingField.template_field_key,
      );
      return {
        id: existingField.id,
        business_id: businessId,
        field_label: desired.field_label,
        field_type: desired.field_type,
        field_options: desired.field_options,
        is_required: desired.is_required,
        field_source: "template",
        template_key: desired.template_key,
        template_field_key: desired.template_field_key,
      };
    });

  const desiredExistingIds = existingWithSource
    .filter((field) => field.field_source === "system" || (
      field.field_source === "template"
      && field.template_key === templateKey
      && targetTemplateIdentities.has(`${field.template_key}.${field.template_field_key}`)
    ))
    .map((field) => field.id);
  const staleTemplateIds = existingWithSource
    .filter((field) => field.field_source === "template"
      && !targetTemplateIdentities.has(`${field.template_key}.${field.template_field_key}`))
    .map((field) => field.id);

  return {
    template,
    missing,
    desiredExistingIds,
    staleTemplateIds,
    templateUpdates,
    applyServiceDefaults: !preserveExistingCustomizations,
  };
};

export async function applyReservationsTemplate({
  businessId,
  templateKey,
  preserveExistingCustomizations = false,
}) {
  const supabase = getSupabase();
  const { data: existing = [], error: loadError } = await supabase
    .from("booking_custom_fields")
    .select("id,field_label,field_type,field_options,is_required,display_order,system_key,is_locked,is_active,field_source,template_key,template_field_key")
    .eq("business_id", businessId);

  if (loadError) throw new Error("Could not load Customer Form fields for template provisioning.");

  const {
    template,
    missing,
    desiredExistingIds,
    staleTemplateIds,
    templateUpdates,
    applyServiceDefaults,
  } = buildReservationsTemplateFieldPlan({
    businessId,
    existing,
    templateKey,
    preserveExistingCustomizations,
  });

  if (missing.length) {
    const { error } = await supabase.from("booking_custom_fields").insert(missing);
    if (error) throw new Error("Could not apply Customer Form template.");
  }

  for (const update of templateUpdates) {
    const { id, business_id: updateBusinessId, ...metadata } = update;
    const { error } = await supabase
      .from("booking_custom_fields")
      .update(metadata)
      .eq("id", id)
      .eq("business_id", updateBusinessId);
    if (error) throw new Error("Could not update Customer Form template fields.");
  }

  if (desiredExistingIds.length) {
    const { error } = await supabase
      .from("booking_custom_fields")
      .update({ is_active: true })
      .in("id", desiredExistingIds)
      .eq("business_id", businessId);
    if (error) throw new Error("Could not activate Customer Form template fields.");
  }

  if (staleTemplateIds.length) {
    const { error } = await supabase
      .from("booking_custom_fields")
      .update({ is_active: false })
      .in("id", staleTemplateIds)
      .eq("business_id", businessId);
    if (error) throw new Error("Could not retire stale Customer Form template fields.");
  }

  const serviceDefaults = applyServiceDefaults
    ? await applyReservationTemplateServiceDefaults({ businessId, templateKey })
    : { service: null };

  return {
    templateKey,
    businessType: template.businessType,
    addedFields: missing.length,
    preservedFields: existing.length,
    retiredFields: staleTemplateIds.length,
    service: serviceDefaults.service,
  };
}

