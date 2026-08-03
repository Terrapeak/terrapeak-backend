import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const {
  buildCustomFieldPrompt,
  normalizeCustomFieldOptions,
  validateCustomFieldAnswer,
} = await import("../utils/reservationCustomFieldService.js");

test("normalizes dropdown options from newline-separated settings", () => {
  assert.deepEqual(normalizeCustomFieldOptions("Mild\nMedium\nHot"), [
    "Mild",
    "Medium",
    "Hot",
  ]);
});

test("rejects a missing required custom field", () => {
  const result = validateCustomFieldAnswer(
    {
      field_label: "Spiciness",
      field_type: "dropdown",
      field_options: "Mild\nMedium\nHot",
      is_required: true,
    },
    "skip",
  );

  assert.equal(result.valid, false);
  assert.match(result.error, /required/i);
});

test("accepts and canonicalizes a configured dropdown option", () => {
  const result = validateCustomFieldAnswer(
    {
      field_label: "Spiciness",
      field_type: "dropdown",
      field_options: "Mild\nMedium\nHot",
      is_required: true,
    },
    "medium",
  );

  assert.deepEqual(result, { valid: true, value: "Medium" });
});

test("allows an optional custom field to be skipped", () => {
  const result = validateCustomFieldAnswer(
    {
      field_label: "Occasion",
      field_type: "text",
      is_required: false,
    },
    "none",
  );

  assert.deepEqual(result, { valid: true, value: "" });
});

test("builds a dropdown prompt containing the configured choices", () => {
  const prompt = buildCustomFieldPrompt({
    field_label: "Spiciness",
    field_type: "dropdown",
    field_options: "Mild\nMedium\nHot",
    is_required: true,
  });

  assert.match(prompt, /Spiciness/);
  assert.match(prompt, /Mild/);
  assert.match(prompt, /Medium/);
  assert.match(prompt, /Hot/);
});
