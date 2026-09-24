import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("ownership-aware Reservations template changes", () => {
  it("adds target defaults without label-based legacy ownership changes", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const { buildReservationsTemplateFieldPlan } = await import(
      "../utils/reservationTemplateService.js"
    );

    const plan = buildReservationsTemplateFieldPlan({
      businessId: 42,
      templateKey: "dental",
      preserveExistingCustomizations: true,
      existing: [
        { id: 1, field_label: "Full name", system_key: "customer_name", is_active: true },
        { id: 2, field_label: "Preferred practitioner", system_key: null, is_active: true },
        { id: 3, field_label: "Reason for visit", system_key: null, is_active: false },
      ],
    });

    assert.deepEqual(plan.missing.map((field) => field.field_label), [
      "Phone",
      "Email",
      "Reason for visit",
      "Procedure",
      "First visit?",
      "Preferred dentist",
    ]);
    assert.equal(plan.missing.every((field) => field.business_id === 42), true);
    assert.deepEqual(plan.desiredExistingIds, [1]);
    assert.deepEqual(plan.staleTemplateIds, []);
    assert.equal(plan.applyServiceDefaults, false);
    assert.equal(plan.missing.some((field) => field.field_label === "Reason for visit" && field.field_source === "template"), true);
  });
});

