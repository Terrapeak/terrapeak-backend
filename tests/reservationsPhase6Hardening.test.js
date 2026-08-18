import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("tenant migration command is dry-run by default and requires exact slug confirmation", async () => {
  const source = await readFile(new URL("../scripts/migrateReservationsBookingModel.js", import.meta.url), "utf8");
  assert.match(source, /const dryRun = await run\(false\)/);
  assert.match(source, /if \(!apply\) process\.exit\(0\)/);
  assert.match(source, /--confirm-slug/);
  assert.match(source, /dryRun\.business_slug/);
});

test("Reservations operational logs avoid customer contact fields", async () => {
  const source = await readFile(new URL("../utils/reservationsOperationalLog.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /email|phone|customer/i);
  assert.match(source, /component: "reservations"/);
});
