import assert from "node:assert/strict";
import test from "node:test";
import { logAiReservationEvent } from "../utils/aiReservationLogger.js";

test("AI Reservations events allow only redacted operational metadata", () => {
  let output = "";
  logAiReservationEvent("reservation_context_resolved", {
    companyId: "company-1",
    businessId: 42,
    outcome: "ok",
    email: "aisha@example.com",
    phone: "+31612345678",
    chatHistory: "private message",
    apiKey: "secret",
  }, { info: (value) => { output = value; } });
  assert.match(output, /company-1/);
  assert.doesNotMatch(output, /aisha@example.com|31612345678|private message|secret/);
});
