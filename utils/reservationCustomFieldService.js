import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const SKIP_VALUES = new Set(["none", "skip", "no", "n/a", "na"]);

export const normalizeCustomFieldOptions = (fieldOptions) => {
  if (Array.isArray(fieldOptions)) {
    return fieldOptions.map((option) => String(option).trim()).filter(Boolean);
  }

  return String(fieldOptions || "")
    .split(/\r?\n|,/)
    .map((option) => option.trim())
    .filter(Boolean);
};

export const buildCustomFieldPrompt = (field) => {
  const label = String(field?.field_label || "Additional information").trim();
  const optionalHint = field?.is_required
    ? ""
    : " You can reply **skip** if you prefer not to answer.";

  if (field?.field_type === "dropdown") {
    const options = normalizeCustomFieldOptions(field.field_options);
    const optionText = options.length ? ` Choose one of: **${options.join("**, **")}**.` : "";
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
    const options = normalizeCustomFieldOptions(field.field_options);
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
    .select("id, field_label, field_type, field_options, is_required, display_order")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) {
    console.error("Booking custom fields query error:", error);
    throw new Error("Could not load reservation custom fields");
  }

  return data || [];
}
