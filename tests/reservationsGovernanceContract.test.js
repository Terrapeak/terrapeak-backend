import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildReservationGovernanceContract } from "../utils/reservationConfiguration.js";

test("bootstrap contract fields are sourced from the effective governance resolver", () => {
  const source = readFileSync(new URL("../services/reservationsSessionService.js", import.meta.url), "utf8");
  assert.match(source, /buildReservationGovernanceContract/);
  assert.match(source, /const governance = buildReservationGovernanceContract/);
  assert.match(source, /\.\.\.governance/);
});

test("stale canonical capability overrides never leak into Platform bootstrap values", () => {
  const contract = buildReservationGovernanceContract({
    company: { reservationTemplate: "general" },
    settings: {
      template_key: "general",
      capabilities: { services: false, teamResources: false, packages: true, guestCount: true },
      terminology: { customerSingular: "Guest" },
      booking_behavior: "request",
      confirmation_message: "Custom confirmation",
    },
  });

  assert.equal(contract.capabilitiesManagedByPlatform, true);
  assert.deepEqual(contract.effectiveCapabilities, {
    services: true,
    teamResources: true,
    scheduledSessions: false,
    packages: false,
    guestCount: false,
  });
  assert.equal(contract.bookingBehavior.booking_behavior, "request");
  assert.equal(contract.confirmationMessage, "Custom confirmation");
});
