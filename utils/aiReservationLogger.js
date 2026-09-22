import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { AsyncLocalStorage } from "node:async_hooks";

const aiReservationTraceStorage = new AsyncLocalStorage();
const SAFE_CODE = /^[A-Z0-9:_-]{1,80}$/;

const SAFE_KEYS = new Set([
  "companyId", "chatbotId", "businessId", "journeyType", "attemptId",
  "outcome", "errorCode", "flowStatus", "latencyMs", "confirmationDecision",
  "enabled", "stage", "ambiguous", "businessSlug", "serviceSlug", "providerSlug",
  "requestFingerprint", "bookingId", "reference", "supabaseErrorCode", "mappedErrorCode",
  "idempotencyKeyHash", "durationMs", "totalMs", "handledBy", "r2bStatus", "r2bStep",
  "operation", "success",
  "traceId", "modelCalled", "modelDurationMs", "unattributedMs",
  "contextSource", "settingsSource", "sessionSource", "tenantContextSource",
]);

export const hashOperationalIdentifier = (value) => createHash("sha256")
  .update(String(value ?? ""))
  .digest("hex")
  .slice(0, 16);

export function logAiReservationEvent(event, fields = {}, logger = console) {
  try {
    const metadata = Object.fromEntries(
      Object.entries({ traceId: aiReservationTraceStorage.getStore(), ...fields })
      .filter(([key, value]) => SAFE_KEYS.has(key) && value !== undefined && value !== null)
      .map(([key, value]) => {
        if (["errorCode", "supabaseErrorCode", "mappedErrorCode"].includes(key)) {
          const code = String(value);
          return [key, SAFE_CODE.test(code) ? code : "UNKNOWN_ERROR"];
        }
        return [key, typeof value === "boolean" ? value : String(value).slice(0, 200)];
      }),
    );
    logger.info(JSON.stringify({
      component: "ai-reservations",
      event,
      occurredAt: new Date().toISOString(),
      ...metadata,
    }));
  } catch {
    // Observability must never break the underlying reservation request.
  }
}

export function runWithAiReservationTrace(traceId, callback) {
  return aiReservationTraceStorage.run(traceId, callback);
}

export function setAiReservationTrace(traceId) {
  aiReservationTraceStorage.enterWith(traceId);
}

export async function measureAiReservationStage({ stage, operation, context, flow, logger = console, onMeasured } = {}, callback) {
  const startedAt = performance.now();
  const report = (durationMs, success, errorCode) => {
    logAiReservationEvent("reservation_performance_stage", {
      stage,
      operation,
      durationMs,
      companyId: context?.companyId,
      chatbotId: context?.chatbotId,
      businessId: context?.reservationBusinessId,
      businessSlug: context?.reservationBusinessSlug,
      flowStatus: flow?.status,
      attemptId: flow?.bookingAttemptId,
      success,
      errorCode,
    }, logger);
    try {
      onMeasured?.({ stage, operation, durationMs, success });
    } catch {
      // A telemetry observer must not affect business logic.
    }
  };
  try {
    const result = await callback();
    report(Math.round(performance.now() - startedAt), true);
    return result;
  } catch (error) {
    report(Math.round(performance.now() - startedAt), false, error?.code);
    throw error;
  }
}
