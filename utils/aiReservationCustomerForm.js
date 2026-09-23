export const CUSTOMER_FIELD_TYPES = Object.freeze([
  "text",
  "textarea",
  "dropdown",
  "checkbox",
  "email",
  "phone",
  "number",
  "date",
]);

const normalizeType = (value) => (value === "select" ? "dropdown" : value || "text");

const normalizeOptions = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
};

export function normalizeCustomerFormField(field = {}) {
  const id = field.id === undefined || field.id === null ? "" : String(field.id);
  const fieldType = normalizeType(field.field_type || field.type);
  return {
    id,
    key: id,
    label: String(field.field_label || field.label || "").trim(),
    type: fieldType,
    options: fieldType === "dropdown" ? normalizeOptions(field.field_options || field.options) : [],
    required: field.is_required === true || field.required === true,
    active: field.is_active !== false && field.active !== false,
    order: Number(field.display_order || field.order || 0),
    systemKey: field.system_key || field.systemKey || null,
    placeholder: String(field.placeholder || ""),
  };
}

export function normalizeCustomerForm(fields = [], { activeOnly = true } = {}) {
  return fields
    .map(normalizeCustomerFormField)
    .filter((field) => !activeOnly || field.active)
    .filter((field) => field.id && field.label)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

const invalid = (message) => ({ valid: false, message });

const CORE_SYSTEM_KEYS = Object.freeze({
  customer_name: "name",
  customer_email: "email",
  customer_phone: "phone",
});

const OPTIONAL_SKIP_VALUES = new Set(["skip", "none", "n/a", "not applicable"]);

export function getCustomerCoreFieldKey(field = {}) {
  const systemKey = String(field.systemKey || "").trim().toLowerCase();
  return CORE_SYSTEM_KEYS[systemKey] || null;
}

export function isOptionalCustomerFormSkip(value) {
  return OPTIONAL_SKIP_VALUES.has(String(value ?? "").trim().toLowerCase());
}

export function customerFormValidationField(field = {}) {
  const coreKey = getCustomerCoreFieldKey(field);
  return coreKey === "email" || coreKey === "phone"
    ? { ...field, type: coreKey }
    : field;
}

const promptLabel = (field) => field.label || "this field";

export function buildCustomerFormPrompt(field = {}) {
  const label = promptLabel(field);
  const optionalSuffix = field.required ? "" : " (Optional — reply 'skip' to continue.)";
  if (field.type === "dropdown") {
    const options = field.options.map((option, index) => `${index + 1}. ${option}`).join("\n");
    return `Please choose your ${label.toLowerCase()}:${options ? `\n\n${options}` : ""}${optionalSuffix}`;
  }
  if (field.type === "checkbox") {
    return `Do you agree to ${label.toLowerCase()}? Please answer Yes or No.${optionalSuffix}`;
  }
  if (field.type === "number") {
    return `Please enter the number for ${label.toLowerCase()}.${optionalSuffix}`;
  }
  if (field.type === "date") {
    return `Please enter your ${label.toLowerCase()} in YYYY-MM-DD format.${optionalSuffix}`;
  }
  if (field.type === "textarea") {
    return `Please tell us ${label.toLowerCase()}.${optionalSuffix}`;
  }
  if (field.type === "email") return `Please enter a valid email address.${optionalSuffix}`;
  if (field.type === "phone") return `Please enter a phone number for ${label.toLowerCase()}.${optionalSuffix}`;
  return `Please enter your ${label.toLowerCase()}.${optionalSuffix}`;
}

export function buildCustomerFormValidationMessage(field, result = {}) {
  const label = promptLabel(field);
  if (result.message?.includes("number")) return `Please enter a number for ${label}.`;
  if (result.message?.includes("YYYY-MM-DD") || field.type === "date") return `Please enter the date in YYYY-MM-DD format.`;
  if (field.type === "checkbox") return "Please answer Yes or No.";
  if (field.type === "dropdown") {
    const options = field.options.map((option, index) => `${index + 1}. ${option}`).join("\n");
    return `Please choose one of the available options${options ? `:\n${options}` : "."}`;
  }
  if (field.type === "email") return "Please enter a valid email address.";
  if (field.type === "phone") return "Please enter a valid phone number.";
  return `Please enter ${label}.`;
}

export function parseCustomerFormInput(field, rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) return { valid: true, value: "", message: null };

  if (field.type === "checkbox") {
    const normalized = value.toLowerCase();
    if (["yes", "y", "true", "checked", "1"].includes(normalized)) return { valid: true, value: true, message: null };
    if (["no", "n", "false", "unchecked", "0"].includes(normalized)) return { valid: true, value: false, message: null };
    return invalid(`${field.label} must be answered with yes or no.`);
  }

  if (field.type === "dropdown") {
    const option = field.options.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
    if (option) return { valid: true, value: option, message: null };
    if (/^\d+$/.test(value)) {
      const index = Number.parseInt(value, 10) - 1;
      if (index >= 0 && index < field.options.length) return { valid: true, value: field.options[index], message: null };
    }
    return invalid(`${field.label} must be one of: ${field.options.join(", ")}.`);
  }

  if (field.type === "number") {
    if (!/^-?[0-9]+([.][0-9]+)?$/.test(value)) return invalid(`${field.label} must be a valid number.`);
    const number = Number(value);
    return Number.isFinite(number)
      ? { valid: true, value: number, message: null }
      : invalid(`${field.label} must be a valid number.`);
  }

  if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return invalid(`${field.label} must use YYYY-MM-DD format.`);
  }

  return { valid: true, value, message: null };
}

export function validateCustomerFormValue(field, value) {
  const empty = value === undefined || value === null || value === "";
  if (field.required && (empty || (field.type === "checkbox" && value !== true))) {
    return invalid(`${field.label} is required.`);
  }
  if (empty) return { valid: true, message: null };
  if (!CUSTOMER_FIELD_TYPES.includes(field.type)) return invalid(`Unsupported Customer Form field type: ${field.type}`);
  if (field.type === "dropdown" && !field.options.includes(String(value))) return invalid(`${field.label} has an invalid option.`);
  if (field.type === "checkbox" && typeof value !== "boolean") return invalid(`${field.label} must be a checkbox value.`);
  if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return invalid(`${field.label} must be a valid email address.`);
  if (field.type === "phone" && (String(value).trim().length < 3 || String(value).length > 50)) return invalid(`${field.label} must be a valid phone number.`);
  if (field.type === "number" && !/^-?[0-9]+([.][0-9]+)?$/.test(String(value))) return invalid(`${field.label} must be a valid number.`);
  if (field.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return invalid(`${field.label} must be a valid date.`);
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) return invalid(`${field.label} must be a valid date.`);
  }
  const maxLength = field.type === "textarea" ? 2000 : 500;
  if (String(value).length > maxLength) return invalid(`${field.label} is too long.`);
  return { valid: true, message: null };
}

export function validateCustomerForm(fields, values = {}) {
  const errors = fields.map((field) => validateCustomerFormValue(customerFormValidationField(field), values[field.id])).filter((result) => !result.valid);
  return errors.length ? errors[0].message : null;
}

export function serializeCustomerFormAnswers(fields, values = {}) {
  const result = {};
  const labels = {};
  for (const field of fields) {
    if (field.systemKey) continue;
    const value = values[field.id];
    if (value === undefined || value === null || value === "") continue;
    result[field.id] = value;
    labels[field.id] = field.label;
  }
  if (Object.keys(labels).length) result._field_labels = labels;
  return result;
}
