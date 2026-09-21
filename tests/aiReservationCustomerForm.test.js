import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOMER_FIELD_TYPES,
  normalizeCustomerForm,
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
