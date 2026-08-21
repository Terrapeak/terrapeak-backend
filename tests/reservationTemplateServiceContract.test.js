import { describe, expect, it } from "vitest";
import { RESERVATION_TEMPLATE_SERVICE_DEFAULTS } from "../utils/reservationTemplateDefaults.js";

describe("Reservations service template contract", () => {
  it("defines defaults for every supported onboarding template", () => {
    expect(Object.keys(RESERVATION_TEMPLATE_SERVICE_DEFAULTS).sort()).toEqual(
      ["general", "physiotherapy", "dental", "salon", "learning_centre", "restaurant"].sort(),
    );
  });
});
