import test from "node:test";
import assert from "node:assert/strict";

import {
  extractReservationReference,
  isBareRescheduleMessage,
  isReservationLookupMessage,
} from "../utils/reservationIntentService.js";
import { restaurantFieldsOnly } from "../utils/reservationFieldScope.js";

test("extracts canonical booking references from conversational messages", () => {
  assert.equal(
    extractReservationReference("Can you show booking bk-856d2b72a4 again?"),
    "BK-856D2B72A4",
  );
});

test("recognizes direct and conversational reservation lookups", () => {
  assert.equal(isReservationLookupMessage("BK-856D2B72A4"), true);
  assert.equal(isReservationLookupMessage("show my restaurant booking"), true);
  assert.equal(isReservationLookupMessage("book a new table"), false);
});

test("does not classify unrelated conversation as a bare reschedule", () => {
  assert.equal(isBareRescheduleMessage("reschedule"), true);
  assert.equal(isBareRescheduleMessage("reschedule appointment"), false);
});

test("restaurant custom fields exclude unrelated generic intake fields", () => {
  const result = restaurantFieldsOnly([
    { field_label: "Main Concern" },
    { field_label: "First Visit" },
    { field_label: "Preferred Therapist" },
    { field_label: "Occasion" },
    { field_label: "Allergies" },
    { field_label: "Seating Preference" },
  ]);

  assert.deepEqual(
    result.map((field) => field.field_label),
    ["Occasion", "Allergies", "Seating Preference"],
  );
});
