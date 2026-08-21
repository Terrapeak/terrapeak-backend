import { describe, expect, it } from "vitest";
import { getReservationsTemplate } from "../config/reservationsTemplates.js";

describe("Reservations template fields", () => {
  it("defines a complete unique 1-10 physiotherapy pain scale", () => {
    const pain = getReservationsTemplate("physiotherapy").fields.find(([label]) => label === "Pain level");
    expect(pain?.[2]).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  });
});
