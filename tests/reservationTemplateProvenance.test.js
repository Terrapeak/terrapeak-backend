import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getReservationsTemplate } from "../config/reservationsTemplates.js";
import { buildReservationsTemplateFieldPlan } from "../utils/reservationTemplateService.js";

const system = (id = 1) => [
  { id, field_label: "Full name", system_key: "customer_name", field_source: "system", is_active: true },
  { id: id + 1, field_label: "Phone", system_key: "customer_phone", field_source: "system", is_active: true },
  { id: id + 2, field_label: "Email", system_key: "customer_email", field_source: "system", is_active: true },
];

const templateField = (id, templateKey, key, label, isActive = true, displayOrder = 100) => ({
  id,
  field_label: label,
  field_source: "template",
  template_key: templateKey,
  template_field_key: key,
  system_key: null,
  is_active: isActive,
  display_order: displayOrder,
});

const customerField = (id, label, isActive = true) => ({
  id, field_label: label, field_source: "customer", system_key: null, is_active: isActive,
});

const legacyField = (id, label, isActive = true) => ({
  id, field_label: label, field_source: "legacy", system_key: null, is_active: isActive,
});

describe("ownership-aware Customer Form template provisioning", () => {
  it("preserves the complete unique Physiotherapy Pain level option set", () => {
    const painLevel = getReservationsTemplate("physiotherapy").fields.find(
      ([label]) => label === "Pain level",
    );
    const options = painLevel?.[2];
    assert.deepEqual(options, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    assert.equal(options.length, 10);
    assert.equal(new Set(options).size, 10);
  });

  it("classifies system and non-system rows without label inference", () => {
    const plan = buildReservationsTemplateFieldPlan({
      businessId: 10,
      templateKey: "physiotherapy",
      existing: [
        ...system(),
        { id: 4, field_label: "Pain level", system_key: null, is_active: true },
      ],
    });
    assert.equal(plan.missing.some((field) => field.template_field_key === "pain_level"), true);
    assert.equal(plan.missing.find((field) => field.template_field_key === "pain_level").field_source, "template");
  });

  it("preserves existing short system-key aliases without creating duplicates", () => {
    const plan = buildReservationsTemplateFieldPlan({
      businessId: 10,
      templateKey: "general",
      existing: [
        { id: 1, field_label: "Full name", system_key: "name", field_source: "system", is_active: true },
        { id: 2, field_label: "Phone", system_key: "phone", field_source: "system", is_active: true },
        { id: 3, field_label: "Email", system_key: "email", field_source: "system", is_active: true },
      ],
    });
    assert.deepEqual(plan.missing, []);
    assert.deepEqual(plan.desiredExistingIds, [1, 2, 3]);
  });

  it("supports General to Physiotherapy with stable template identities", () => {
    const plan = buildReservationsTemplateFieldPlan({ businessId: 10, templateKey: "physiotherapy", existing: system() });
    assert.deepEqual(plan.missing.map((field) => field.template_field_key), [
      "main_concern", "affected_region", "first_visit", "preferred_therapist", "pain_level",
    ]);
  });

  it("supports Physiotherapy to General by deactivating only template-owned rows", () => {
    const plan = buildReservationsTemplateFieldPlan({
      businessId: 10,
      templateKey: "general",
      existing: [...system(), templateField(4, "physiotherapy", "main_concern", "Main concern"), legacyField(9, "Pain level")],
    });
    assert.deepEqual(plan.staleTemplateIds, [4]);
    assert.equal(plan.staleTemplateIds.includes(9), false);
    assert.deepEqual(plan.missing, []);
  });

  it("supports Physiotherapy to Dental without label collisions", () => {
    const plan = buildReservationsTemplateFieldPlan({
      businessId: 10,
      templateKey: "dental",
      existing: [...system(), templateField(4, "physiotherapy", "first_visit", "First visit?")],
    });
    assert.equal(plan.staleTemplateIds.includes(4), true);
    assert.equal(plan.missing.some((field) => field.template_key === "dental" && field.template_field_key === "first_visit"), true);
  });

  it("reactivates original template rows across Physiotherapy-General-Physiotherapy", () => {
    const first = buildReservationsTemplateFieldPlan({
      businessId: 10,
      templateKey: "physiotherapy",
      existing: [...system(), templateField(4, "physiotherapy", "main_concern", "Main concern", false)],
    });
    assert.equal(first.missing.some((field) => field.template_field_key === "main_concern"), false);
    assert.equal(first.desiredExistingIds.includes(4), true);
    const second = buildReservationsTemplateFieldPlan({
      businessId: 10,
      templateKey: "physiotherapy",
      existing: [...system(), templateField(4, "physiotherapy", "main_concern", "Main concern", false)],
    });
    assert.equal(second.missing.some((field) => field.template_field_key === "main_concern"), false);
    assert.equal(second.desiredExistingIds.includes(4), true);
  });

  it("preserves customer and legacy fields and their active state", () => {
    const plan = buildReservationsTemplateFieldPlan({
      businessId: 10,
      templateKey: "dental",
      existing: [...system(), customerField(4, "Preferred language", false), legacyField(5, "Special requests", true)],
    });
    assert.equal(plan.staleTemplateIds.includes(4), false);
    assert.equal(plan.staleTemplateIds.includes(5), false);
    assert.equal(plan.missing.some((field) => field.field_label === "Preferred language"), false);
  });

  it("deactivates obsolete template rows and activates the target rows", () => {
    const plan = buildReservationsTemplateFieldPlan({
      businessId: 10,
      templateKey: "dental",
      existing: [...system(), templateField(4, "physiotherapy", "main_concern", "Main concern"), templateField(5, "dental", "procedure", "Procedure", false)],
    });
    assert.deepEqual(plan.staleTemplateIds, [4]);
    assert.equal(plan.desiredExistingIds.includes(5), true);
  });

  it("keeps system rows active and stable", () => {
    const plan = buildReservationsTemplateFieldPlan({ businessId: 10, templateKey: "general", existing: system() });
    assert.deepEqual(plan.desiredExistingIds, [1, 2, 3]);
  });

  it("is idempotent for repeated same-template application", () => {
    const existing = [
      ...system(),
      templateField(4, "physiotherapy", "main_concern", "Main concern"),
      templateField(5, "physiotherapy", "pain_level", "Pain level"),
    ];
    const plan = buildReservationsTemplateFieldPlan({ businessId: 10, templateKey: "physiotherapy", existing });
    assert.equal(plan.missing.length, 3);
    assert.equal(plan.staleTemplateIds.length, 0);
    const complete = [...existing, ...plan.missing.map((field, index) => ({ ...field, id: 10 + index }))];
    const second = buildReservationsTemplateFieldPlan({ businessId: 10, templateKey: "physiotherapy", existing: complete });
    assert.equal(second.missing.length, 0);
  });

  it("keeps stable IDs and display-order customization on reapplication", () => {
    const plan = buildReservationsTemplateFieldPlan({
      businessId: 10,
      templateKey: "physiotherapy",
      existing: [...system(), templateField(44, "physiotherapy", "pain_level", "Old label", true, 777)],
    });
    assert.equal(plan.missing.some((field) => field.template_field_key === "pain_level"), false);
    assert.equal(plan.templateUpdates.find((field) => field.id === 44).field_label, "Pain level");
    assert.equal(Object.hasOwn(plan.templateUpdates.find((field) => field.id === 44), "display_order"), false);
  });

  it("creates shared visible labels with distinct identities", () => {
    const physio = buildReservationsTemplateFieldPlan({ businessId: 10, templateKey: "physiotherapy", existing: system() });
    const dental = buildReservationsTemplateFieldPlan({ businessId: 10, templateKey: "dental", existing: system() });
    assert.equal(physio.missing.find((field) => field.field_label === "First visit?").template_field_key, "first_visit");
    assert.equal(dental.missing.find((field) => field.field_label === "First visit?").template_field_key, "first_visit");
    assert.notEqual("physiotherapy.first_visit", "dental.first_visit");
  });

  it("never hijacks a legacy Pain level row", () => {
    const plan = buildReservationsTemplateFieldPlan({
      businessId: 10,
      templateKey: "physiotherapy",
      existing: [...system(), legacyField(20, "Pain level")],
    });
    assert.equal(plan.missing.find((field) => field.template_field_key === "pain_level").field_source, "template");
    assert.equal(plan.staleTemplateIds.includes(20), false);
  });

  it("treats an old writer row without provenance as legacy", () => {
    const plan = buildReservationsTemplateFieldPlan({
      businessId: 10,
      templateKey: "general",
      existing: [...system(), { id: 20, field_label: "Old writer field", system_key: null, is_active: true }],
    });
    assert.equal(plan.missing.some((field) => field.field_label === "Old writer field"), false);
    assert.equal(plan.staleTemplateIds.includes(20), false);
  });

  it("leaves active fields as the chatbot/public read contract", () => {
    const plan = buildReservationsTemplateFieldPlan({
      businessId: 10,
      templateKey: "general",
      existing: [...system(), legacyField(20, "Visible legacy", true), templateField(21, "physiotherapy", "pain_level", "Pain level", true)],
    });
    assert.deepEqual(plan.staleTemplateIds, [21]);
    assert.equal(plan.desiredExistingIds.includes(20), false);
  });

  it("does not encode booking answers or history changes", () => {
    const plan = buildReservationsTemplateFieldPlan({ businessId: 10, templateKey: "restaurant", existing: system() });
    assert.equal(Object.keys(plan).includes("bookingAnswers"), false);
  });
});
