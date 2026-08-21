import { describe, expect, it } from "vitest";
import { getReservationTemplateServiceDefaults } from "../utils/reservationTemplateDefaults.js";

describe("Reservations template service defaults", () => {
  it("uses a physiotherapy appointment for physiotherapy", () => {
    const defaults = getReservationTemplateServiceDefaults("physiotherapy");
    expect(defaults.businessType).toBe("physiotherapy");
    expect(defaults.name).toBe("Physiotherapy Appointment");
    expect(defaults.slug).toBe("physiotherapy-appointment");
  });

  it("keeps restaurant-specific defaults only for restaurant", () => {
    expect(getReservationTemplateServiceDefaults("restaurant").name).toBe("Restaurant Reservation");
    expect(getReservationTemplateServiceDefaults("dental").name).not.toBe("Restaurant Reservation");
  });
});
