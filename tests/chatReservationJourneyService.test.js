import assert from "node:assert/strict";
import test from "node:test";
import { resolveChatReservationJourney } from "../services/chatReservationJourneyService.js";

const configuration = (templateKey, capabilities = {}) => ({ templateKey, capabilities });

test("resolves appointment-like templates", () => {
  for (const templateKey of ["general", "physiotherapy", "dental", "salon"]) {
    assert.equal(resolveChatReservationJourney({ configuration: configuration(templateKey), service: { schedulingMode: "generated" } }).journeyType, "appointment");
  }
});

test("capabilities and service mode select restaurant, scheduled, and cohort journeys", () => {
  assert.equal(resolveChatReservationJourney({ configuration: configuration("restaurant"), service: {} }).journeyType, "restaurant");
  assert.equal(resolveChatReservationJourney({ configuration: configuration("general", { scheduledSessions: true }), service: { schedulingMode: "scheduled" } }).journeyType, "scheduled_session");
  assert.equal(resolveChatReservationJourney({ configuration: configuration("learning_centre"), service: { enrollmentMode: "cohort" } }).journeyType, "cohort_enquiry");
});

test("capabilities override a template default without inventing a separate controller", () => {
  const result = resolveChatReservationJourney({
    configuration: configuration("general", { guestCount: true }),
    service: { schedulingMode: "generated" },
  });
  assert.equal(result.journeyType, "restaurant");
  assert.equal(result.templateKey, "general");
});
