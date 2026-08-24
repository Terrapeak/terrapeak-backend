import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("safe Reservations template changes", () => {
  it("adds missing defaults without reactivating, retiring, or changing service defaults", async () => {
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
      "Procedure",
      "First visit?",
    ]);
    assert.equal(plan.missing.every((field) => field.business_id === 42), true);
    assert.deepEqual(plan.desiredExistingIds, []);
    assert.deepEqual(plan.staleTemplateIds, []);
    assert.equal(plan.applyServiceDefaults, false);
  });
});

