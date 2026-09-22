import { createHash } from "node:crypto";

const SAFE_KEYS = new Set([
  "companyId", "chatbotId", "businessId", "journeyType", "attemptId",
  "outcome", "errorCode", "flowStatus", "latencyMs", "confirmationDecision",
  "enabled", "stage", "ambiguous", "businessSlug", "serviceSlug", "providerSlug",
  "requestFingerprint", "bookingId", "reference", "supabaseErrorCode", "mappedErrorCode",
  "idempotencyKeyHash",
]);

export const hashOperationalIdentifier = (value) => createHash("sha256")
  .update(String(value ?? ""))
  .digest("hex")
  .slice(0, 16);

export function logAiReservationEvent(event, fields = {}, logger = console) {
  const metadata = Object.fromEntries(
    Object.entries(fields)
      .filter(([key, value]) => SAFE_KEYS.has(key) && value !== undefined && value !== null)
      .map(([key, value]) => [key, typeof value === "boolean" ? value : String(value).slice(0, 200)]),
  );
  logger.info(JSON.stringify({
    component: "ai-reservations",
    event,
    occurredAt: new Date().toISOString(),
    ...metadata,
  }));
}
