import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOMER_FIELD_TYPES,
  buildCustomerFormPrompt,
  getCustomerCoreFieldKey,
  isOptionalCustomerFormSkip,
  normalizeCustomerForm,
  parseCustomerFormInput,
  serializeCustomerFormAnswers,
  validateCustomerForm,
} from "../utils/aiReservationCustomerForm.js";

const fields = [
  { id: 1, field_label: "Email", field_type: "email", is_required: true, display_order: 2 },
  { id: 2, field_label: "Visit type", field_type: "select", field_options: "Check-up\nCleaning", is_required: true, display_order: 1 },
  { id: 3, field_label: "Consent", field_type: "checkbox", system_key: "consent", is_required: true, display_order: 3 },
  { id: 4, field_label: "Date", field_type: "date", display_order: 4 },
];

test("normalizes the canonical eight field types and stable IDs", () => {
  assert.deepEqual(CUSTOMER_FIELD_TYPES, ["text", "textarea", "dropdown", "checkbox", "email", "phone", "number", "date"]);
  const result = normalizeCustomerForm(fields);
  assert.deepEqual(result.map((field) => field.id), ["2", "1", "3", "4"]);
  assert.equal(result[0].type, "dropdown");
  assert.deepEqual(result[0].options, ["Check-up", "Cleaning"]);
});

test("validates required, dropdown, email, and date values", () => {
  const normalized = normalizeCustomerForm(fields);
  assert.match(validateCustomerForm(normalized, { "1": "bad", "2": "Check-up", "3": true }), /valid email/);
  assert.match(validateCustomerForm(normalized, { "1": "a@example.com", "2": "Unknown", "3": true }), /invalid option/);
  assert.match(validateCustomerForm(normalized, { "1": "a@example.com", "2": "Check-up", "3": true, "4": "2026-02-31" }), /valid date/);
  assert.equal(validateCustomerForm(normalized, { "1": "a@example.com", "2": "Check-up", "3": true, "4": "2026-09-21" }), null);
});

test("serializes custom data by stable IDs and excludes system fields", () => {
  const normalized = normalizeCustomerForm(fields);
  const result = serializeCustomerFormAnswers(normalized, { "1": "a@example.com", "2": "Check-up", "3": true });
  assert.equal(result["1"], "a@example.com");
  assert.equal(result["2"], "Check-up");
  assert.equal(result["3"], undefined);
  assert.equal(result._field_labels["2"], "Visit type");
});

test("parses customer form values into canonical field types", () => {
  const normalized = normalizeCustomerForm([
    { id: "dropdown", field_label: "Dropdown", field_type: "dropdown", field_options: ["Option A", "Option B"] },
    { id: "checkbox", field_label: "Checkbox", field_type: "checkbox" },
    { id: "number", field_label: "Number", field_type: "number" },
    { id: "date", field_label: "Date", field_type: "date" },
  ]);
  const byId = Object.fromEntries(normalized.map((field) => [field.id, field]));

  assert.equal(parseCustomerFormInput(byId.dropdown, "option a").value, "Option A");
  assert.equal(parseCustomerFormInput(byId.checkbox, "No").value, false);
  assert.equal(parseCustomerFormInput(byId.checkbox, "yes").value, true);
  assert.equal(parseCustomerFormInput(byId.number, "10").value, 10);
  assert.equal(parseCustomerFormInput(byId.date, "2026-09-22").value, "2026-09-22");
  assert.match(parseCustomerFormInput(byId.dropdown, "Option C").message, /Option A, Option B/);
  assert.match(parseCustomerFormInput(byId.checkbox, "maybe").message, /yes or no/);
  assert.match(parseCustomerFormInput(byId.number, "ten").message, /valid number/);
  assert.match(parseCustomerFormInput(byId.date, "22\/09\/2026").message, /YYYY-MM-DD/);
});

test("required checkbox still rejects false after parsing", () => {
  const field = normalizeCustomerForm([{ id: "consent", field_label: "Consent", field_type: "checkbox", is_required: true }])[0];
  const parsed = parseCustomerFormInput(field, "No");
  assert.equal(parsed.valid, true);
  assert.match(validateCustomerForm([field], { consent: parsed.value }), /Consent is required/);
});

test("uses canonical system identity and safe dropdown ordinals", () => {
  const normalized = normalizeCustomerForm([
    { id: "name", field_label: "Customer name", field_type: "text", system_key: "customer_name" },
    { id: "company", field_label: "Company Name", field_type: "text" },
    { id: "contact", field_label: "Preferred contact method", field_type: "dropdown", field_options: ["Email", "Phone", "WhatsApp"] },
  ]);
  const byId = Object.fromEntries(normalized.map((field) => [field.id, field]));
  assert.equal(getCustomerCoreFieldKey(byId.name), "name");
  assert.equal(getCustomerCoreFieldKey(byId.company), null);
  assert.equal(parseCustomerFormInput(byId.contact, "2").value, "Phone");
  assert.equal(parseCustomerFormInput(byId.contact, "2 people").valid, false);
  assert.equal(parseCustomerFormInput(byId.contact, "whatsapp").value, "WhatsApp");
  assert.equal(isOptionalCustomerFormSkip("N/A"), true);
  assert.equal(isOptionalCustomerFormSkip("maybe"), false);
  assert.match(buildCustomerFormPrompt({ label: "Additional notes", type: "textarea", required: false }), /Optional/);
});

test("mapped core email and phone use canonical validation", () => {
  const normalized = normalizeCustomerForm([
    { id: "email", field_label: "Email", field_type: "text", system_key: "customer_email", is_required: true },
    { id: "phone", field_label: "Phone", field_type: "text", system_key: "customer_phone", is_required: true },
  ]);
  assert.match(validateCustomerForm(normalized, { email: "bad", phone: "123456" }), /valid email/);
  assert.match(validateCustomerForm(normalized, { email: "a@example.com", phone: "" }), /Phone is required/);
  assert.equal(validateCustomerForm(normalized, { email: "a@example.com", phone: "+60123456789" }), null);
});

test("supports both short and long canonical customer system aliases", () => {
  const normalized = normalizeCustomerForm([
    { id: "short-name", field_label: "Full name", field_type: "text", system_key: "name" },
    { id: "long-email", field_label: "Email", field_type: "email", system_key: "customer_email" },
    { id: "short-phone", field_label: "Phone", field_type: "phone", system_key: "phone" },
    { id: "collision", field_label: "Emergency Phone", field_type: "phone", system_key: "emergency_phone" },
  ]);
  const byId = Object.fromEntries(normalized.map((field) => [field.id, field]));
  assert.equal(getCustomerCoreFieldKey(byId["short-name"]), "name");
  assert.equal(getCustomerCoreFieldKey(byId["long-email"]), "email");
  assert.equal(getCustomerCoreFieldKey(byId["short-phone"]), "phone");
  assert.equal(getCustomerCoreFieldKey(byId.collision), null);
  assert.equal(validateCustomerForm(normalized, {
    "short-name": "Aisha",
    "long-email": "aisha@example.com",
    "short-phone": "+31612345678",
    collision: "not-mapped",
  }), null);
});
