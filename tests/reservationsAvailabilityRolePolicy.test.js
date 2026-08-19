import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Reservations staff can view but cannot manage their own availability", async () => {
  const source = await readFile(
    new URL("../controllers/companyController.js", import.meta.url),
    "utf8",
  );

  const staffPolicy = source.match(/staff:\s*\{([\s\S]*?)\n\s*\},\n\s*viewer:/)?.[1] || "";
  assert.match(staffPolicy, /manageAvailability:\s*false/);
  assert.match(staffPolicy, /manageOwnAvailability:\s*false/);
  assert.match(staffPolicy, /viewOwnAvailability:\s*true/);
});
