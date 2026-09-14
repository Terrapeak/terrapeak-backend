import assert from "node:assert/strict";
import test from "node:test";

import { serializePublicSession } from "../utils/publicSessionSerializer.js";

test("public session serialization excludes callback PII and internal context", () => {
  const session = {
    sessionId: "session-public-test",
    chatbotId: "chatbot-public-test",
    appointmentStep: "date",
    preActivationData: { source: "website" },
    chatLogs: [{ role: "model", text: "Welcome" }],
    updatedAt: new Date("2026-09-14T00:00:00.000Z"),
    reservationCallbackRequestedAt: new Date("2026-09-14T00:01:00.000Z"),
    reservationCallbackName: "Private Customer",
    reservationCallbackContact: "private@example.test",
    reservationCallbackPreferredTime: "tomorrow morning",
    reservationCallbackQuestion: "Private customer concern",
    reservationCallbackServiceOrTeacher: "Private Service",
    reservationCallbackSummary: "Conversation context\nRecent transcript",
    reservationCallbackBookingUrl: "https://reservations.example.test/book/test",
  };

  const response = serializePublicSession(session);

  assert.deepEqual(response, {
    sessionId: session.sessionId,
    chatbotId: session.chatbotId,
    appointmentStep: session.appointmentStep,
    preActivationData: session.preActivationData,
    chatLogs: session.chatLogs,
    updatedAt: session.updatedAt,
  });
  assert.equal("reservationCallback" in response, false);
  assert.equal(JSON.stringify(response).includes("Private Customer"), false);
  assert.equal(JSON.stringify(response).includes("private@example.test"), false);
  assert.equal(JSON.stringify(response).includes("Recent transcript"), false);
});

test("public session serialization preserves customer session restoration data", () => {
  const response = serializePublicSession({
    sessionId: "session-restore-test",
    chatbotId: "chatbot-restore-test",
    appointmentStep: "chooseSlot",
    preActivationData: { reservationBusinessSlug: "terrapeak" },
    chatLogs: [{ role: "user", text: "I want an appointment" }],
    updatedAt: new Date("2026-09-14T00:02:00.000Z"),
  });

  assert.equal(response.sessionId, "session-restore-test");
  assert.equal(response.chatbotId, "chatbot-restore-test");
  assert.equal(response.appointmentStep, "chooseSlot");
  assert.deepEqual(response.preActivationData, {
    reservationBusinessSlug: "terrapeak",
  });
  assert.deepEqual(response.chatLogs, [
    { role: "user", text: "I want an appointment" },
  ]);
});
