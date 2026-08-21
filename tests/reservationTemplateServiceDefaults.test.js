import { describe, expect, it } from "vitest";
import { getReservationTemplateServiceDefaults } from "../utils/reservationTemplateDefaults.js";

describe("template-aware service adapter", () => {
  it("does not present physiotherapy as a restaurant", () => {
    const physio = getReservationTemplateServiceDefaults("physiotherapy");
    expect(physio.businessType).toBe("physiotherapy");
    expect(physio.name).toMatch(/Physiotherapy/);
    expect(physio.description).not.toMatch(/restaurant/i);
  });
});
