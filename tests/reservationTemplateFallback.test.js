import { describe, expect, it } from "vitest";
import { getReservationTemplateServiceDefaults } from "../utils/reservationTemplateDefaults.js";

describe("Reservations service fallback", () => {
  it("falls back to general appointments", () => {
    expect(getReservationTemplateServiceDefaults("unknown").name).toBe("Appointment");
  });
});
