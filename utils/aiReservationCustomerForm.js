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
    return option
      ? { valid: true, value: option, message: null }
      : invalid(`${field.label} must be one of: ${field.options.join(", ")}.`);
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
  const errors = fields.map((field) => validateCustomerFormValue(field, values[field.id])).filter((result) => !result.valid);
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
