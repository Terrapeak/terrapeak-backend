import assert from "node:assert/strict";
import test from "node:test";
import { logAiReservationEvent, measureAiReservationStage, runWithAiReservationTrace } from "../utils/aiReservationLogger.js";

const context = {
  companyId: "company-1",
  chatbotId: "chatbot-1",
  reservationBusinessId: 42,
  reservationBusinessSlug: "tenant-a",
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("performance telemetry records safe stage duration and no request content", async () => {
  let output = "";
  await measureAiReservationStage({
    stage: "mock_stage",
    operation: "mock_dependency",
    context,
    flow: { status: "service_selection", bookingAttemptId: "attempt-1" },
    logger: { info: (value) => { output = value; } },
  }, async () => {
    await delay(15);
    return { customerName: "not logged" };
  });

  const event = JSON.parse(output);
  assert.equal(event.event, "reservation_performance_stage");
  assert.equal(event.stage, "mock_stage");
  assert.equal(event.operation, "mock_dependency");
  assert.equal(event.success, true);
  assert.equal(typeof event.durationMs, "string");
  assert.ok(Number(event.durationMs) >= 0);
  assert.doesNotMatch(output, /customerName|not logged|email|phone|secret|token/i);
});

test("performance telemetry records safe error classification", async () => {
  let output = "";
  await assert.rejects(
    measureAiReservationStage({
      stage: "mock_failure",
      operation: "mock_dependency",
      context,
      logger: { info: (value) => { output = value; } },
    }, async () => {
      const error = new Error("private provider details");
      error.code = "SAFE_ERROR";
      throw error;
    }),
    (error) => error.code === "SAFE_ERROR",
  );
  const event = JSON.parse(output);
  assert.equal(event.success, false);
  assert.equal(event.errorCode, "SAFE_ERROR");
  assert.doesNotMatch(output, /private provider details/i);
});

test("logger failures do not affect the measured operation", async () => {
  const result = await measureAiReservationStage({
    stage: "logger_failure",
    operation: "mock_dependency",
    logger: { info: () => { throw new Error("logger unavailable"); } },
  }, async () => "underlying result");
  assert.equal(result, "underlying result");
});

test("stage events carry a safe trace ID and model timing fields", async () => {
  let output = "";
  await runWithAiReservationTrace("trace-test-123", () => measureAiReservationStage({
    stage: "model_call",
    operation: "gemini_request",
    logger: { info: (value) => { output = value; } },
  }, async () => "model result"));
  const event = JSON.parse(output);
  assert.equal(event.traceId, "trace-test-123");

  output = "";
  logAiReservationEvent("chatbot_request_timing", {
    totalMs: 12,
    unattributedMs: 3,
    modelCalled: false,
    modelDurationMs: null,
  }, { info: (value) => { output = value; } });
  const summary = JSON.parse(output);
  assert.equal(summary.modelCalled, false);
  assert.equal(summary.unattributedMs, "3");
  assert.equal(summary.modelDurationMs, undefined);
});
