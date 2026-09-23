import assert from "node:assert/strict";
import test from "node:test";
import { RESERVATIONS_TEMPLATES } from "../config/reservationsTemplates.js";
import {
  NEUTRAL_RESERVATION_TERMINOLOGY,
  resolveReservationsConfiguration,
} from "../utils/reservationConfiguration.js";
import { getReservationProvisioningPlan } from "../utils/reservationProvisioningPlan.js";

const templateKeys = [
  "general",
  "dental",
  "physiotherapy",
  "salon",
  "learning_centre",
  "restaurant",
];

test("all supported templates resolve capabilities and terminology", () => {
  for (const templateKey of templateKeys) {
    const resolved = resolveReservationsConfiguration({ templateKey });
    assert.equal(resolved.templateKey, templateKey);
    assert.ok(Object.values(resolved.capabilities).every((value) => typeof value === "boolean"));
    assert.ok(resolved.terminology.customerSingular);
    assert.ok(resolved.terminology.bookingPlural);
    assert.ok(RESERVATIONS_TEMPLATES[templateKey].fields);
  }
});

test("tenant terminology and capabilities override template defaults", () => {
  const resolved = resolveReservationsConfiguration({
    templateKey: "dental",
    terminology: { customerSingular: "Client", teamMemberSingular: "Clinician" },
    capabilities: { packages: true },
  });

  assert.equal(resolved.terminology.customerSingular, "Client");
  assert.equal(resolved.terminology.teamMemberSingular, "Clinician");
  assert.equal(resolved.capabilities.packages, true);
  assert.equal(resolved.terminology.bookingSingular, "Appointment");
});

test("platform-authoritative templates ignore persisted capability and terminology overrides", () => {
  const resolved = resolveReservationsConfiguration({
    templateKey: "general",
    capabilities: { teamResources: false, guestCount: true },
    terminology: { customerSingular: "Client" },
    platformAuthoritative: true,
  });

  assert.deepEqual(resolved.capabilities, {
    services: true,
    teamResources: true,
    scheduledSessions: false,
    packages: false,
    guestCount: false,
  });
  assert.equal(resolved.terminology.customerSingular, "Customer");
});

test("platform-authoritative template envelopes match each supported template", () => {
  assert.deepEqual(
    resolveReservationsConfiguration({ templateKey: "physiotherapy", capabilities: { packages: false, guestCount: true }, platformAuthoritative: true }).capabilities,
    { services: true, teamResources: true, scheduledSessions: false, packages: true, guestCount: false },
  );
  assert.deepEqual(
    resolveReservationsConfiguration({ templateKey: "restaurant", capabilities: { services: true, guestCount: false }, platformAuthoritative: true }).capabilities,
    { services: false, teamResources: false, scheduledSessions: false, packages: false, guestCount: true },
  );
});

test("template defaults override neutral terminology", () => {
  const resolved = resolveReservationsConfiguration({ templateKey: "physiotherapy" });
  assert.equal(resolved.terminology.customerSingular, "Patient");
  assert.notEqual(resolved.terminology.customerSingular, NEUTRAL_RESERVATION_TERMINOLOGY.customerSingular);
});

test("unknown or missing templates use safe general defaults", () => {
  for (const templateKey of [undefined, null, "unknown", "restaurant-ish"]) {
    const resolved = resolveReservationsConfiguration({ templateKey });
    assert.equal(resolved.templateKey, "general");
    assert.equal(resolved.businessType, "general");
    assert.equal(resolved.terminology.customerSingular, "Customer");
    assert.equal(resolved.capabilities.guestCount, false);
  }
});

test("template customer fields retain semantic types and options", () => {
  const field = (template, label) => RESERVATIONS_TEMPLATES[template].fields.find(([name]) => name === label);
  assert.deepEqual(field("dental", "Procedure").slice(1, 3), [
    "dropdown",
    ["Check-up", "Cleaning", "Filling", "Extraction", "Emergency", "Other"],
  ]);
  assert.deepEqual(field("physiotherapy", "First visit?").slice(1, 3), ["dropdown", ["Yes", "No"]]);
  assert.deepEqual(field("learning_centre", "First visit?").slice(1, 3), ["dropdown", ["Yes", "No"]]);
  assert.deepEqual(field("salon", "First visit?").slice(1, 3), ["dropdown", ["Yes", "No"]]);
});

test("new non-restaurant tenants do not receive restaurant compatibility provisioning", () => {
  for (const templateKey of ["dental", "physiotherapy", "salon", "learning_centre", "general"]) {
    const plan = getReservationProvisioningPlan({ reservationTemplate: templateKey });
    assert.equal(plan.restaurantCompatibility, false);
    assert.notEqual(plan.businessType, "restaurant");
  }
  assert.equal(getReservationProvisioningPlan({ reservationTemplate: "restaurant" }).restaurantCompatibility, true);
});

test("legacy companies without a template retain restaurant compatibility", () => {
  const plan = getReservationProvisioningPlan({});
  assert.equal(plan.legacyRestaurant, true);
  assert.equal(plan.templateKey, "restaurant");
  assert.equal(plan.restaurantCompatibility, true);
});
