import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const SKIP_VALUES = new Set(["none", "skip", "no", "n/a", "na"]);

const optionLabel = (option) => {
  if (option === undefined || option === null) return "";

  if (typeof option === "object") {
    return String(
      option.label ??
        option.name ??
        option.value ??
        option.text ??
        "",
    ).trim();
  }

  return String(option).trim();
};

export const normalizeCustomFieldOptions = (fieldOptions) => {
  if (fieldOptions === undefined || fieldOptions === null || fieldOptions === "") {
    return [];
  }

  if (Array.isArray(fieldOptions)) {
    return fieldOptions.map(optionLabel).filter(Boolean);
  }

  if (typeof fieldOptions === "object") {
    const nestedOptions =
      fieldOptions.options ??
      fieldOptions.choices ??
      fieldOptions.values ??
      fieldOptions.items ??
      [];

    return normalizeCustomFieldOptions(nestedOptions);
  }

  const text = String(fieldOptions).trim();
  if (!text) return [];

  if (
    (text.startsWith("[") && text.endsWith("]")) ||
    (text.startsWith("{") && text.endsWith("}"))
  ) {
    try {
      return normalizeCustomFieldOptions(JSON.parse(text));
    } catch {
      // Fall through to newline/comma parsing for malformed legacy values.
    }
  }

  return text
    .split(/\r?\n|,/)
    .map((option) => option.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
};

const getFieldOptions = (field = {}) =>
  normalizeCustomFieldOptions(
    field.field_options ??
      field.options ??
      field.dropdown_options ??
      field.choices,
  );

export const buildCustomFieldPrompt = (field) => {
  const label = String(field?.field_label || "Additional information").trim();
  const optionalHint = field?.is_required
    ? ""
    : " You can reply **skip** if you prefer not to answer.";

  if (field?.field_type === "dropdown") {
    const options = getFieldOptions(field);
    const optionText = options.length
      ? ` Choose one of: **${options.join("**, **")}**.`
      : " Please enter your preferred option.";
    return `${label}?${optionText}${optionalHint}`;
  }

  if (field?.field_type === "checkbox") {
    return `${label}? Please reply **yes** or **no**.${optionalHint}`;
  }

  return `${label}?${optionalHint}`;
};

export const validateCustomFieldAnswer = (field, rawAnswer) => {
  const answer = String(rawAnswer || "").trim();
  const normalized = answer.toLowerCase();
  const skipped = SKIP_VALUES.has(normalized);

  if (!answer || skipped) {
    if (field?.is_required) {
      return {
        valid: false,
        error: `${field.field_label} is required. Please provide an answer.`,
      };
    }

    return { valid: true, value: "" };
  }

  if (field?.field_type === "dropdown") {
    const options = getFieldOptions(field);

    // Do not trap the customer in a loop if a legacy dropdown has no readable
    // options. The answer is still stored while the configuration is repaired.
    if (!options.length) {
      return { valid: true, value: answer };
    }

    const match = options.find((option) => option.toLowerCase() === normalized);

    if (!match) {
      return {
        valid: false,
        error: `Please choose one of: ${options.join(", ")}.`,
      };
    }

    return { valid: true, value: match };
  }

  if (field?.field_type === "checkbox") {
    if (["yes", "y", "true", "1"].includes(normalized)) {
      return { valid: true, value: "Yes" };
    }

    if (["no", "n", "false", "0"].includes(normalized)) {
      return { valid: true, value: "No" };
    }

    return { valid: false, error: "Please reply yes or no." };
  }

  if (field?.field_type === "number" && Number.isNaN(Number(answer))) {
    return { valid: false, error: "Please enter a valid number." };
  }

  return { valid: true, value: answer };
};

export async function getActiveBookingCustomFields(businessId) {
  const { data, error } = await supabase
    .from("booking_custom_fields")
    .select("*")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) {
    console.error("Booking custom fields query error:", error);
    throw new Error("Could not load reservation custom fields");
  }

  return (data || []).map((field) => ({
    ...field,
    field_options:
      field.field_options ??
      field.options ??
      field.dropdown_options ??
      field.choices ??
      [],
  }));
}
