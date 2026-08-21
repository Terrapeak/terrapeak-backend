import { describe, expect, it } from "vitest";
import { RESERVATION_TEMPLATE_SERVICE_DEFAULTS as templates } from "../utils/reservationTemplateDefaults.js";

describe("industry service names", () => {
  it("does not leak restaurant wording into non-restaurant templates", () => {
    for (const [key, value] of Object.entries(templates)) {
      if (key !== "restaurant") expect(value.name.toLowerCase()).not.toContain("restaurant");
    }
  });
});
